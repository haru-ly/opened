// ════════════════════════════════════════════════
//  OPENED — app.js
//  Firebase Auth + Firestore logic
// ════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, getDocs, onSnapshot,
  serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Firebase 초기화 ──────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCuIC2sbMdD1yEW92NNKFG_PD5fCB8TIlI",
  authDomain: "opened-me.firebaseapp.com",
  projectId: "opened-me",
  storageBucket: "opened-me.firebasestorage.app",
  messagingSenderId: "202253781297",
  appId: "1:202253781297:web:043c0c3e82d5ba96a48810",
};

const fbApp  = initializeApp(firebaseConfig);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);

// ════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════
let currentUser   = null;   // Firebase Auth user
let currentProfile= null;   // Firestore user doc
let calYear       = new Date().getFullYear();
let calMonth      = new Date().getMonth();
let activeNoticeId= null;
let unsubNotices  = null;
let unsubComments = null;
let unsubChat     = null;   // 현재 열린 채팅방 메시지 구독
let unsubThreads  = null;   // 관리자: 대화 목록 구독
let unsubUnread   = null;   // 안 읽은 메시지 뱃지 구독
let activeChatUid = null;   // 관리자가 보고 있는 멤버 uid
let editingNoticeId = null; // 수정 중인 공지 id
let isRegisteringMember = false; // 관리자가 멤버 등록 중일 때 onAuthStateChanged 부작용 방지용 플래그

// ════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const show = (id) => $(id)?.classList.remove('hidden');
const hide = (id) => $(id)?.classList.add('hidden');

function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.add('hidden'), duration);
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function ymd(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysDiff(ts) {
  if (!ts) return 999;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ════════════════════════════════════════════════
//  AUTH STATE
// ════════════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  // 관리자가 멤버 등록 중(createUserWithEmailAndPassword 호출 직후)이면
  // 이 콜백이 멤버 계정으로 잘못 전환되는 걸 막기 위해 완전히 무시한다.
  // save-register-member 핸들러가 끝나면서 직접 signOut → 관리자 재로그인 흐름을 처리한다.
  if (isRegisteringMember) return;

  if (user) {
    currentUser = user;
    await loadProfile(user.uid);

    // 삭제(비활성화)된 계정이면 강제 로그아웃
    if (currentProfile?.disabled) {
      showToast('🚫 삭제된 계정입니다. 더 이상 로그인할 수 없습니다. 문의가 필요하면 관리자에게 연락하세요.', 5000);
      await signOut(auth);
      return;
    }

    // 차단(suspend) 상태 확인
    const suspendedUntil = currentProfile?.suspendedUntil;
    const isPermSuspended = suspendedUntil === 'permanent';
    const suspendedMs = suspendedUntil?.toMillis ? suspendedUntil.toMillis() : 0;
    const isTempSuspended = suspendedMs > Date.now();

    if (isPermSuspended || isTempSuspended) {
      const untilText = isPermSuspended ? '영구 차단' : `${formatDate(suspendedUntil)}까지 차단`;
      showToast(`🚫 계정이 차단되었습니다 (${untilText}).`, 5000);
      await signOut(auth);
      return;
    }

    await updateLastSeen(user.uid);
    showApp();
  } else {
    currentUser = null;
    currentProfile = null;
    showAuthScreen();
  }
});

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    currentProfile = { id: snap.id, ...snap.data() };
  } else if (!isRegisteringMember) {
    // 프로필이 없으면 기본 생성 (단, 멤버 등록 처리 중에는 건드리지 않음)
    currentProfile = { id: uid, name: currentUser.email.split('@')[0], role: 'user' };
    await setDoc(doc(db, 'users', uid), {
      name: currentProfile.name,
      email: currentUser.email,
      role: 'user',
      createdAt: serverTimestamp(),
    });
  }
}

async function updateLastSeen(uid) {
  await setDoc(doc(db, 'users', uid), { lastSeen: serverTimestamp() }, { merge: true });
}

// ════════════════════════════════════════════════
//  SCREEN SWITCH
// ════════════════════════════════════════════════
function showAuthScreen() {
  $('auth-screen').classList.add('active');
  $('app-screen').classList.remove('active');
  if (unsubNotices) { unsubNotices(); unsubNotices = null; }
  if (unsubComments) { unsubComments(); unsubComments = null; }
  if (unsubChat) { unsubChat(); unsubChat = null; }
  if (unsubThreads) { unsubThreads(); unsubThreads = null; }
}

function showApp() {
  $('auth-screen').classList.remove('active');
  $('app-screen').classList.add('active');

  // 사용자 정보 세팅
  const name   = currentProfile?.name || '—';
  const role   = currentProfile?.role === 'admin' ? '관리자' : '멤버';
  $('sidebar-name').textContent  = name;
  $('sidebar-role').textContent  = role;
  $('sidebar-avatar').textContent= name[0]?.toUpperCase() || '?';

  // 관리자 메뉴 표시
  const isAdmin = currentProfile?.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    isAdmin ? el.classList.remove('hidden') : el.classList.add('hidden');
  });

  // 채팅 메뉴 라벨 조정
  $('chat-nav-label').textContent = isAdmin ? '1:1 채팅' : '관리자에게 문의';
  $('chat-page-title').textContent = isAdmin ? '1:1 채팅' : '관리자에게 문의';
  if (isAdmin) {
    $('chat-user-view').classList.add('hidden');
    $('chat-admin-view').classList.remove('hidden');
  } else {
    $('chat-user-view').classList.remove('hidden');
    $('chat-admin-view').classList.add('hidden');
  }

  // 기본 페이지 로드
  navigateTo('attendance');

  // 안 읽은 메시지 뱃지 구독 시작
  subscribeUnreadBadge();
}

// ════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════
function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const btn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (btn) btn.classList.add('active');
  const pg = $(`page-${page}`);
  if (pg) pg.classList.add('active');

  // 페이지별 로드
  if (page === 'attendance') loadAttendancePage();
  if (page === 'lyrics')     loadLyricsPage();
  if (page === 'notice')     loadNoticePage();
  if (page === 'chat')       loadChatPage();
  if (page === 'admin')      loadAdminPage();
  if (page === 'settings')   {}  // 정적

  // 모바일 사이드바 닫기
  $('sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

$('btn-open-settings').addEventListener('click', () => navigateTo('settings'));

// 사이드바 토글 (모바일)
$('sidebar-toggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
});

// ════════════════════════════════════════════════
//  LOGIN / REGISTER
// ════════════════════════════════════════════════
$('btn-login').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  const pw    = $('login-password').value;
  hide('login-error');
  if (!email || !pw) return showError('login-error', '이메일과 비밀번호를 입력하세요.');
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    showError('login-error', getAuthError(e.code));
  }
});

$('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-login').click();
});

$('goto-register').addEventListener('click', () => {
  $('login-form').classList.remove('active');
  $('register-form').classList.add('active');
});

$('goto-login').addEventListener('click', () => {
  $('register-form').classList.remove('active');
  $('login-form').classList.add('active');
});

$('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
});

function showError(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function getAuthError(code) {
  const map = {
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/user-not-found':     '존재하지 않는 계정입니다.',
    'auth/wrong-password':     '비밀번호가 올바르지 않습니다.',
    'auth/too-many-requests':  '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
    'auth/email-already-in-use':'이미 사용 중인 이메일입니다.',
    'auth/user-disabled':      '이 계정은 사용이 중지되었습니다.',
  };
  return map[code] || '오류가 발생했습니다. (' + code + ')';
}

// ════════════════════════════════════════════════
//  ATTENDANCE
// ════════════════════════════════════════════════
async function loadAttendancePage() {
  if (!currentUser) return;
  const attSnap = await getDocs(
    query(collection(db, 'attendance'), where('uid', '==', currentUser.uid))
  );
  const checkedDates = new Set();
  attSnap.forEach(d => checkedDates.add(d.data().date)); // 'YYYY-MM-DD'

  $('attendance-stats').innerHTML =
    `총 <strong style="color:var(--accent)">${checkedDates.size}</strong>일 출석`;

  renderCalendar(checkedDates);
  renderAttendanceLog(checkedDates);
}

function renderCalendar(checkedDates) {
  const label   = $('cal-month-label');
  const grid    = $('calendar-grid');
  const today   = new Date();
  const todayStr= ymd(today);

  label.textContent = `${calYear}년 ${calMonth + 1}월`;
  grid.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const lastDate  = new Date(calYear, calMonth + 1, 0).getDate();
  const prevLast  = new Date(calYear, calMonth, 0).getDate();

  // 이전 달 채우기
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevLast - i;
    addCalDay(grid, d, 'other-month', null, false);
  }

  // 이번 달
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday   = dateStr === todayStr;
    const isChecked = checkedDates.has(dateStr);
    const dow       = new Date(calYear, calMonth, d).getDay();
    let cls = '';
    if (dow === 0) cls = 'sunday';
    if (dow === 6) cls = 'saturday';
    addCalDay(grid, d, cls, dateStr, isChecked, isToday);
  }

  // 다음 달 채우기
  const cells = firstDay + lastDate;
  const remaining = cells % 7 === 0 ? 0 : 7 - (cells % 7);
  for (let d = 1; d <= remaining; d++) {
    addCalDay(grid, d, 'other-month', null, false);
  }
}

function addCalDay(grid, day, extraClass, dateStr, checked, isToday = false) {
  const el = document.createElement('div');
  el.className = 'cal-day';
  if (extraClass) el.classList.add(extraClass);

  const today = new Date();
  const todayStr = ymd(today);

  if (checked && dateStr && dateStr !== todayStr) {
    el.classList.add('past-checked');
    el.title = dateStr;
  } else if (checked && isToday) {
    el.classList.add('checked');
  } else if (isToday) {
    el.classList.add('today');
    el.title = '클릭하여 출석체크';
    el.addEventListener('click', () => doAttendanceCheck(dateStr, el));
  }

  el.textContent = day;
  grid.appendChild(el);
}

async function doAttendanceCheck(dateStr, el) {
  if (!currentUser) return;
  // 이미 체크한 경우
  const docRef = doc(db, 'attendance', `${currentUser.uid}_${dateStr}`);
  const snap   = await getDoc(docRef);
  if (snap.exists()) return;

  await setDoc(docRef, {
    uid:  currentUser.uid,
    date: dateStr,
    checkedAt: serverTimestamp(),
  });

  el.classList.remove('today');
  el.classList.add('checked');
  showToast('✅ 출석체크 완료!');
  loadAttendancePage();
}

function renderAttendanceLog(checkedDates) {
  const list = $('attendance-log-list');
  const sorted = [...checkedDates].sort().reverse();
  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state">아직 출석 기록이 없습니다.</div>';
    return;
  }
  list.innerHTML = sorted.map((d, i) =>
    `<div class="log-item">
      <span class="log-date">${d}</span>
      <span class="badge badge-accent">${i === 0 ? '최근' : '출석'}</span>
    </div>`
  ).join('');
}

// 달력 이전/다음 월
$('cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  loadAttendancePage();
});
$('cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  loadAttendancePage();
});

// ════════════════════════════════════════════════
//  LYRICS / ASSIGNMENTS
// ════════════════════════════════════════════════
async function loadLyricsPage() {
  const list = $('assignments-list');
  list.innerHTML = '<div class="empty-state">로딩 중...</div>';

  const snap = await getDocs(
    query(collection(db, 'assignments'), orderBy('deadline', 'desc'))
  );
  if (snap.empty) {
    list.innerHTML = '<div class="empty-state">등록된 과제가 없습니다.</div>';
    return;
  }

  // 내 제출 목록 조회
  const mySubmissionsSnap = await getDocs(
    query(collection(db, 'lyrics'), where('uid', '==', currentUser.uid))
  );
  const submitted = new Set();
  mySubmissionsSnap.forEach(d => submitted.add(d.data().assignmentId));

  list.innerHTML = '';
  snap.forEach(d => {
    const a = { id: d.id, ...d.data() };
    const deadline  = a.deadline?.toDate ? a.deadline.toDate() : new Date(a.deadline);
    const expired   = deadline < new Date();
    const isSubmit  = submitted.has(a.id);

    const card = document.createElement('div');
    card.className = `assignment-card${expired ? ' expired' : ''}${isSubmit ? ' submitted' : ''}`;
    card.innerHTML = `
      <div class="assign-topic">${a.topic}</div>
      <div class="assign-desc">${a.description || '주제에 맞는 1절 작사본을 제출하세요.'}</div>
      <div class="assign-meta">
        <span>마감: ${deadline.toLocaleDateString('ko-KR')}</span>
        <span class="badge ${isSubmit ? 'badge-accent' : expired ? 'badge-red' : 'badge-green'}">
          ${isSubmit ? '제출완료' : expired ? '마감됨' : '제출가능'}
        </span>
      </div>`;

    if (!expired && !isSubmit) {
      card.addEventListener('click', () => openLyricsModal(a));
    }
    list.appendChild(card);
  });
}

function openLyricsModal(assignment) {
  $('modal-lyrics-title').textContent = `📝 ${assignment.topic}`;
  const dl = assignment.deadline?.toDate ? assignment.deadline.toDate() : new Date(assignment.deadline);
  $('modal-lyrics-meta').textContent = `마감: ${dl.toLocaleDateString('ko-KR')}`;
  $('lyrics-content').value = '';
  hide('lyrics-error');
  $('modal-submit-lyrics').dataset.assignId = assignment.id;
  show('modal-submit-lyrics');
  $('modal-submit-lyrics').classList.remove('hidden');
  setTimeout(() => $('lyrics-content').focus(), 100);
}

['close-lyrics-modal', 'cancel-lyrics', 'close-lyrics-modal-btn'].forEach(id => {
  $(id)?.addEventListener('click', () => hide('modal-submit-lyrics'));
});

$('submit-lyrics').addEventListener('click', async () => {
  const content   = $('lyrics-content').value.trim();
  const assignId  = $('modal-submit-lyrics').dataset.assignId;
  if (!content) return showError('lyrics-error', '가사 내용을 입력해주세요.');

  try {
    await addDoc(collection(db, 'lyrics'), {
      uid:          currentUser.uid,
      userName:     currentProfile?.name || '—',
      assignmentId: assignId,
      content,
      submittedAt:  serverTimestamp(),
    });
    hide('modal-submit-lyrics');
    showToast('🎵 작사본이 제출되었습니다!');
    loadLyricsPage();
  } catch (e) {
    showError('lyrics-error', '제출 중 오류가 발생했습니다: ' + e.message);
  }
});

// 과제 등록 (관리자)
$('btn-add-assignment')?.addEventListener('click', () => {
  $('assignment-topic').value = '';
  $('assignment-deadline').value = '';
  $('assignment-desc').value = '';
  hide('assignment-error');
  show('modal-add-assignment');
  $('modal-add-assignment').classList.remove('hidden');
});

['close-assignment-modal', 'cancel-assignment'].forEach(id => {
  $(id)?.addEventListener('click', () => hide('modal-add-assignment'));
});

$('save-assignment').addEventListener('click', async () => {
  const topic    = $('assignment-topic').value.trim();
  const deadline = $('assignment-deadline').value;
  const desc     = $('assignment-desc').value.trim();
  if (!topic || !deadline) return showError('assignment-error', '주제와 마감일은 필수입니다.');

  try {
    await addDoc(collection(db, 'assignments'), {
      topic,
      description: desc,
      deadline: Timestamp.fromDate(new Date(deadline + 'T23:59:59')),
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
    });
    hide('modal-add-assignment');
    showToast('✅ 과제가 등록되었습니다.');
    loadLyricsPage();
  } catch (e) {
    showError('assignment-error', '등록 실패: ' + e.message);
  }
});

// ════════════════════════════════════════════════
//  NOTICE
// ════════════════════════════════════════════════
function loadNoticePage() {
  const list = $('notice-list');
  list.innerHTML = '<div class="empty-state">로딩 중...</div>';

  if (unsubNotices) unsubNotices();
  unsubNotices = onSnapshot(
    query(collection(db, 'notices'), orderBy('createdAt', 'desc')),
    (snap) => {
      if (snap.empty) {
        list.innerHTML = '<div class="empty-state">공지사항이 없습니다.</div>';
        return;
      }
      list.innerHTML = '';
      snap.forEach(d => {
        const n = { id: d.id, ...d.data() };
        const item = document.createElement('div');
        item.className = 'notice-item';
        item.innerHTML = `
          <div class="notice-icon">📢</div>
          <div class="notice-content">
            <div class="notice-item-title">${n.title}</div>
            <div class="notice-item-preview">${n.body?.slice(0, 60) || ''}...</div>
          </div>
          <div class="notice-item-date">${formatDate(n.createdAt)}</div>`;
        item.addEventListener('click', () => openNoticeDetail(n));
        list.appendChild(item);
      });
    }
  );
}

function openNoticeDetail(notice) {
  activeNoticeId = notice.id;
  $('notice-detail-title').textContent = notice.title;
  $('notice-detail-meta').textContent  = `게시일: ${formatDate(notice.createdAt)}`;
  $('notice-detail-body').textContent  = notice.body;
  $('comment-input').value = '';
  show('modal-notice-detail');
  $('modal-notice-detail').classList.remove('hidden');
  loadComments(notice.id);
}

function loadComments(noticeId) {
  if (unsubComments) unsubComments();
  const clist = $('comment-list');
  clist.innerHTML = '';
  unsubComments = onSnapshot(
    query(collection(db, 'notices', noticeId, 'comments'), orderBy('createdAt', 'asc')),
    (snap) => {
      clist.innerHTML = '';
      if (snap.empty) {
        clist.innerHTML = '<div style="color:var(--text-mute);font-size:12px;">아직 댓글이 없습니다.</div>';
        return;
      }
      snap.forEach(d => {
        const c = d.data();
        clist.innerHTML += `
          <div class="comment-item">
            <div class="comment-author">${c.userName || '—'}</div>
            <div class="comment-text">${c.text}</div>
            <div class="comment-time">${formatDateTime(c.createdAt)}</div>
          </div>`;
      });
      clist.scrollTop = clist.scrollHeight;
    }
  );
}

['close-notice-detail-btn', 'close-notice-detail-backdrop'].forEach(id => {
  $(id)?.addEventListener('click', () => {
    hide('modal-notice-detail');
    if (unsubComments) { unsubComments(); unsubComments = null; }
    activeNoticeId = null;
  });
});

$('btn-submit-comment').addEventListener('click', submitComment);
$('comment-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitComment();
});

async function submitComment() {
  const text = $('comment-input').value.trim();
  if (!text || !activeNoticeId) return;
  await addDoc(collection(db, 'notices', activeNoticeId, 'comments'), {
    uid:      currentUser.uid,
    userName: currentProfile?.name || '—',
    text,
    createdAt: serverTimestamp(),
  });
  $('comment-input').value = '';
}

// 공지 작성 (관리자)
$('btn-add-notice')?.addEventListener('click', () => {
  $('notice-title-input').value = '';
  $('notice-body-input').value  = '';
  hide('notice-error');
  show('modal-add-notice');
  $('modal-add-notice').classList.remove('hidden');
});

['close-add-notice-modal', 'cancel-notice'].forEach(id => {
  $(id)?.addEventListener('click', () => hide('modal-add-notice'));
});

$('save-notice').addEventListener('click', async () => {
  const title = $('notice-title-input').value.trim();
  const body  = $('notice-body-input').value.trim();
  if (!title || !body) return showError('notice-error', '제목과 내용을 입력하세요.');
  try {
    await addDoc(collection(db, 'notices'), {
      title,
      body,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      authorName: currentProfile?.name || '관리자',
    });
    hide('modal-add-notice');
    showToast('📢 공지가 등록되었습니다.');
  } catch (e) {
    showError('notice-error', '등록 실패: ' + e.message);
  }
});

// 공지 수정 (관리자)
$('btn-edit-notice')?.addEventListener('click', async () => {
  if (!activeNoticeId) return;
  const snap = await getDoc(doc(db, 'notices', activeNoticeId));
  if (!snap.exists()) return;
  const n = snap.data();
  editingNoticeId = activeNoticeId;
  $('edit-notice-title-input').value = n.title || '';
  $('edit-notice-body-input').value  = n.body  || '';
  hide('edit-notice-error');
  hide('modal-notice-detail');
  show('modal-edit-notice');
  $('modal-edit-notice').classList.remove('hidden');
});

['close-edit-notice-modal', 'cancel-edit-notice'].forEach(id => {
  $(id)?.addEventListener('click', () => { hide('modal-edit-notice'); editingNoticeId = null; });
});

$('save-edit-notice').addEventListener('click', async () => {
  const title = $('edit-notice-title-input').value.trim();
  const body  = $('edit-notice-body-input').value.trim();
  if (!title || !body) return showError('edit-notice-error', '제목과 내용을 입력하세요.');
  if (!editingNoticeId) return;
  try {
    await updateDoc(doc(db, 'notices', editingNoticeId), {
      title,
      body,
      editedAt: serverTimestamp(),
    });
    hide('modal-edit-notice');
    editingNoticeId = null;
    showToast('✏️ 공지가 수정되었습니다.');
  } catch (e) {
    showError('edit-notice-error', '수정 실패: ' + e.message);
  }
});

// 공지 삭제 (관리자)
$('btn-delete-notice')?.addEventListener('click', async () => {
  if (!activeNoticeId) return;
  if (!confirm('이 공지를 삭제하시겠습니까? 댓글도 함께 삭제됩니다.')) return;
  try {
    // 하위 댓글 먼저 삭제
    const commentsSnap = await getDocs(collection(db, 'notices', activeNoticeId, 'comments'));
    await Promise.all(commentsSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'notices', activeNoticeId));
    hide('modal-notice-detail');
    if (unsubComments) { unsubComments(); unsubComments = null; }
    activeNoticeId = null;
    showToast('🗑️ 공지가 삭제되었습니다.');
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 3500);
  }
});

// ════════════════════════════════════════════════
//  1:1 CHAT (관리자 ↔ 멤버)
//  구조: chats/{memberUid}/messages/{msgId}
//        chats/{memberUid} 문서 자체는 메타(lastMessage, lastAt, unread 등) 보관
// ════════════════════════════════════════════════

function loadChatPage() {
  const isAdmin = currentProfile?.role === 'admin';
  if (isAdmin) {
    loadChatThreadList();
  } else {
    openChatRoom(currentUser.uid, false);
  }
}

// ── 멤버용: 본인-관리자 채팅방 열기 ──
function openChatRoom(memberUid, isAdminView, memberName) {
  const messagesEl = isAdminView ? $('chat-messages-admin') : $('chat-messages-user');
  messagesEl.innerHTML = '';

  if (unsubChat) { unsubChat(); unsubChat = null; }

  let threadData = {};

  unsubChat = onSnapshot(doc(db, 'chats', memberUid), (threadSnap) => {
    threadData = threadSnap.exists() ? threadSnap.data() : {};
    renderChatMessages();
  });

  // 메시지 + 스레드 메타(읽음 시각) 둘 다 구독하되, 메시지 쪽이 메인 트리거
  const unsubMsgs = onSnapshot(
    query(collection(db, 'chats', memberUid, 'messages'), orderBy('createdAt', 'asc')),
    (snap) => {
      window._lastChatSnap = snap;
      renderChatMessages();
    }
  );

  const prevUnsub = unsubChat;
  unsubChat = () => { prevUnsub(); unsubMsgs(); };

  function renderChatMessages() {
    const snap = window._lastChatSnap;
    if (!snap) return;
    messagesEl.innerHTML = '';
    const otherReadField = isAdminView ? 'userLastReadAt' : 'adminLastReadAt';
    const otherReadAt = threadData[otherReadField]?.toMillis ? threadData[otherReadField].toMillis() : 0;

    snap.forEach(d => {
      const m = d.data();
      const mine = m.senderUid === currentUser.uid;
      const createdMs = m.createdAt?.toMillis ? m.createdAt.toMillis() : 0;
      const withinHour = createdMs && (Date.now() - createdMs) < 3600000;
      const isRead = mine && otherReadAt > 0 && createdMs > 0 && otherReadAt >= createdMs;

      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${mine ? 'mine' : 'theirs'}`;

      if (m.deleted) {
        bubble.classList.add('deleted');
        bubble.innerHTML = `<span class="chat-deleted-text">삭제된 메시지입니다</span>
          <span class="chat-bubble-time">${formatDateTime(m.createdAt)}</span>`;
      } else {
        const canEdit = mine && withinHour;
        const canAdminDelete = isAdminView && currentProfile?.role === 'admin';
        bubble.innerHTML = `
          <span class="chat-bubble-text">${escapeHtml(m.text)}${m.editedAt ? ' <span class="chat-edited-tag">(수정됨)</span>' : ''}</span>
          <span class="chat-bubble-time">
            ${formatDateTime(m.createdAt)}
            ${mine ? `<span class="chat-read-status">${isRead ? '읽음' : '전송됨'}</span>` : ''}
          </span>
          ${(canEdit || canAdminDelete) ? `
          <span class="chat-bubble-actions">
            ${canEdit ? `<button class="chat-action-btn" data-action="edit" data-id="${d.id}">수정</button>` : ''}
            ${(canEdit || canAdminDelete) ? `<button class="chat-action-btn" data-action="delete" data-id="${d.id}">삭제</button>` : ''}
          </span>` : ''}`;
      }
      messagesEl.appendChild(bubble);
    });

    // 메시지 액션 바인딩
    messagesEl.querySelectorAll('.chat-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = btn.dataset.id;
        if (btn.dataset.action === 'edit') startEditMessage(memberUid, msgId, messagesEl);
        if (btn.dataset.action === 'delete') deleteMessage(memberUid, msgId, isAdminView && currentProfile?.role === 'admin');
      });
    });

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 읽음 처리: 내가 이 방을 보고 있다는 표시 (시각 기록)
  const readField = isAdminView ? 'adminLastReadAt' : 'userLastReadAt';
  const unreadField = isAdminView ? 'adminUnread' : 'userUnread';
  setDoc(doc(db, 'chats', memberUid), {
    [readField]: serverTimestamp(),
    [unreadField]: 0,
  }, { merge: true }).catch(() => {});

  if (isAdminView) {
    activeChatUid = memberUid;
    $('chat-admin-header').textContent = memberName || '대화 중';
    $('chat-input-admin').disabled = false;
    $('btn-send-chat-admin').disabled = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── 메시지 수정 (1시간 이내, 본인만) ──
function startEditMessage(memberUid, msgId, messagesEl) {
  const existingBubble = [...messagesEl.children].find(el =>
    el.querySelector(`[data-id="${msgId}"]`)
  );
  const textEl = existingBubble?.querySelector('.chat-bubble-text');
  const currentText = textEl ? textEl.textContent.replace(/\(수정됨\)\s*$/, '').trim() : '';

  const newText = prompt('메시지 수정', currentText);
  if (newText === null) return; // 취소
  if (!newText.trim()) { showToast('내용을 입력해주세요.'); return; }

  updateDoc(doc(db, 'chats', memberUid, 'messages', msgId), {
    text: newText.trim(),
    editedAt: serverTimestamp(),
  }).catch(e => showToast('수정 실패: ' + e.message, 3000));
}

// ── 메시지 삭제 (본인 1시간 이내 또는 관리자는 언제든) ──
function deleteMessage(memberUid, msgId, isAdminForceDelete) {
  if (!confirm('이 메시지를 삭제하시겠습니까?')) return;
  updateDoc(doc(db, 'chats', memberUid, 'messages', msgId), {
    deleted: true,
    text: '',
    deletedAt: serverTimestamp(),
    deletedBy: isAdminForceDelete ? 'admin' : 'self',
  }).catch(e => showToast('삭제 실패: ' + e.message, 3000));
}

// ── 멤버용 전송 ──
async function sendChatMessage(memberUid, text, isAdminView) {
  if (!text.trim()) return;
  await addDoc(collection(db, 'chats', memberUid, 'messages'), {
    senderUid:  currentUser.uid,
    senderName: currentProfile?.name || '—',
    senderRole: currentProfile?.role || 'user',
    text:       text.trim(),
    createdAt:  serverTimestamp(),
  });

  const unreadField = isAdminView ? 'userUnread' : 'adminUnread'; // 상대방 쪽 unread 증가
  await setDoc(doc(db, 'chats', memberUid), {
    lastMessage: text.trim(),
    lastAt: serverTimestamp(),
    memberUid,
    memberName: isAdminView ? ($('chat-admin-header').textContent) : (currentProfile?.name || '—'),
    [unreadField]: 1, // 단순화: 1로 마킹 (정확한 카운트 대신 "안읽음 있음" 플래그로 사용)
  }, { merge: true });
}

$('btn-send-chat-user').addEventListener('click', () => {
  const input = $('chat-input-user');
  sendChatMessage(currentUser.uid, input.value, false);
  input.value = '';
});
$('chat-input-user').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-send-chat-user').click();
});

$('btn-send-chat-admin').addEventListener('click', () => {
  if (!activeChatUid) return;
  const input = $('chat-input-admin');
  sendChatMessage(activeChatUid, input.value, true);
  input.value = '';
});
$('chat-input-admin').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-send-chat-admin').click();
});

// ── 관리자용: 대화 목록 ──
function loadChatThreadList() {
  const container = $('chat-thread-items');
  if (unsubThreads) unsubThreads();

  unsubThreads = onSnapshot(
    query(collection(db, 'chats'), orderBy('lastAt', 'desc')),
    (snap) => {
      if (snap.empty) {
        container.innerHTML = '<div class="empty-state">아직 대화가 없습니다.</div>';
        return;
      }
      container.innerHTML = '';
      snap.forEach(d => {
        const t = d.data();
        const memberUid = d.id;
        const hasUnread = (t.adminUnread || 0) > 0;
        const item = document.createElement('div');
        item.className = `chat-thread-item${activeChatUid === memberUid ? ' active' : ''}`;
        item.innerHTML = `
          <div class="chat-thread-avatar">${(t.memberName || '?')[0]}</div>
          <div class="chat-thread-info">
            <div class="chat-thread-name">${t.memberName || memberUid}</div>
            <div class="chat-thread-preview">${t.lastMessage || ''}</div>
          </div>
          ${hasUnread ? '<span class="nav-badge">N</span>' : ''}`;
        item.addEventListener('click', () => {
          document.querySelectorAll('.chat-thread-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          openChatRoom(memberUid, true, t.memberName);
        });
        container.appendChild(item);
      });
    }
  );
}

// ── 사이드바 안 읽은 메시지 뱃지 ──
function subscribeUnreadBadge() {
  if (unsubUnread) unsubUnread();
  const isAdmin = currentProfile?.role === 'admin';
  const badge = $('chat-unread-badge');

  if (isAdmin) {
    // 관리자: 모든 채팅방 중 adminUnread > 0 인 게 있으면 표시
    unsubUnread = onSnapshot(collection(db, 'chats'), (snap) => {
      let count = 0;
      snap.forEach(d => { if ((d.data().adminUnread || 0) > 0) count++; });
      if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    });
  } else {
    // 멤버: 본인 채팅방의 userUnread 확인
    unsubUnread = onSnapshot(doc(db, 'chats', currentUser.uid), (snap) => {
      const unread = snap.exists() ? (snap.data().userUnread || 0) : 0;
      if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    }, () => { badge.classList.add('hidden'); });
  }
}

// ════════════════════════════════════════════════
//  ADMIN PAGE
// ════════════════════════════════════════════════
async function loadAdminPage() {
  loadAdminTab('members');
}

// 탭 전환
document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`admin-tab-${btn.dataset.tab}`).classList.add('active');
    loadAdminTab(btn.dataset.tab);
  });
});

async function loadAdminTab(tab) {
  if (tab === 'members')         await loadMembersTable();
  if (tab === 'attendance-admin')await loadAdminAttendance();
  if (tab === 'lyrics-admin')    await loadAdminLyrics();
  if (tab === 'alerts')          await loadAlerts();
}

async function loadMembersTable() {
  const tbody = $('members-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-mute)">로딩 중...</td></tr>';
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
  if (snap.empty) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">멤버 없음</td></tr>'; return; }

  tbody.innerHTML = '';
  let visibleCount = 0;
  snap.forEach(d => {
    const u = d.data();
    if (u.disabled) return; // 삭제(비활성화)된 멤버는 목록에서 숨김
    visibleCount++;
    const uid = d.id;
    const inactive = daysDiff(u.lastSeen) >= 7;
    const isSelf = uid === currentUser.uid;

    const suspendedUntilMs = u.suspendedUntil?.toMillis ? u.suspendedUntil.toMillis() : 0;
    const isPermSuspended = u.suspendedUntil === 'permanent';
    const isSuspended = isPermSuspended || (suspendedUntilMs > Date.now());

    let statusBadge;
    if (isSuspended) {
      statusBadge = `<span class="badge badge-red">${isPermSuspended ? '영구 차단' : '차단 중 (' + formatDate(u.suspendedUntil) + '까지)'}</span>`;
    } else if (inactive) {
      statusBadge = `<span class="badge badge-red">미접속</span>`;
    } else {
      statusBadge = `<span class="badge badge-green">활성</span>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.name || '—'}</td>
      <td style="color:var(--text-sub)">${u.email || '—'}</td>
      <td><span class="badge ${u.role === 'admin' ? 'badge-accent' : 'badge-muted'}">${u.role === 'admin' ? '관리자' : '멤버'}</span></td>
      <td style="color:var(--text-sub)">${formatDate(u.createdAt)}</td>
      <td style="color:var(--text-sub)">${formatDate(u.lastSeen)}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="row-actions">
          <button class="btn-icon btn-chat-member" title="채팅" data-uid="${uid}" data-name="${u.name || ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          </button>
          ${isSelf ? '' : `
          ${isSuspended ? `
          <button class="btn-icon btn-unsuspend-member" title="차단 해제" data-uid="${uid}" data-name="${u.name || u.email}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
          </button>` : `
          <button class="btn-icon btn-suspend-member" title="차단" data-uid="${uid}" data-name="${u.name || u.email}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>
          </button>`}
          <button class="btn-icon danger btn-delete-member" title="삭제" data-uid="${uid}" data-name="${u.name || u.email}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>`}
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  if (visibleCount === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">멤버 없음</td></tr>';
    return;
  }

  // 채팅 바로가기
  tbody.querySelectorAll('.btn-chat-member').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo('chat');
      setTimeout(() => openChatRoom(btn.dataset.uid, true, btn.dataset.name), 50);
    });
  });

  // 삭제(비활성화)
  tbody.querySelectorAll('.btn-delete-member').forEach(btn => {
    btn.addEventListener('click', () => {
      $('confirm-delete-member-text').textContent = `"${btn.dataset.name}" 님을 삭제하시겠습니까?`;
      $('modal-confirm-delete-member').dataset.targetUid = btn.dataset.uid;
      show('modal-confirm-delete-member');
      $('modal-confirm-delete-member').classList.remove('hidden');
    });
  });

  // 차단
  tbody.querySelectorAll('.btn-suspend-member').forEach(btn => {
    btn.addEventListener('click', () => {
      $('suspend-member-text').textContent = `"${btn.dataset.name}" 님을 차단합니다.`;
      $('modal-suspend-member').dataset.targetUid = btn.dataset.uid;
      hide('suspend-error');
      show('modal-suspend-member');
      $('modal-suspend-member').classList.remove('hidden');
    });
  });

  // 차단 해제
  tbody.querySelectorAll('.btn-unsuspend-member').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'users', btn.dataset.uid), {
          suspendedUntil: null,
          suspendedAt: null,
        });
        showToast(`✅ "${btn.dataset.name}" 님의 차단이 해제되었습니다.`);
        loadMembersTable();
      } catch (e) {
        showToast('해제 실패: ' + e.message, 3000);
      }
    });
  });
}

['close-confirm-delete-modal', 'cancel-delete-member'].forEach(id => {
  $(id)?.addEventListener('click', () => hide('modal-confirm-delete-member'));
});

$('confirm-delete-member').addEventListener('click', async () => {
  const targetUid = $('modal-confirm-delete-member').dataset.targetUid;
  if (!targetUid) return;
  if (targetUid === currentUser.uid) {
    showToast('본인 계정은 삭제할 수 없습니다.');
    hide('modal-confirm-delete-member');
    return;
  }
  try {
    await deleteAllMemberRecords(targetUid);

    // Auth 계정은 클라이언트 권한상 직접 삭제 불가 → 문서를 비활성화 상태로 남겨
    // 다음 로그인 시 차단되도록 처리 (문서를 완전히 지우면 로그인 시 프로필이
    // 자동 재생성되어 비활성화가 풀리므로, 삭제하지 않고 disabled만 표시)
    await setDoc(doc(db, 'users', targetUid), {
      disabled: true,
      disabledAt: serverTimestamp(),
      role: 'disabled', // 목록/대시보드 노출에서 제외하기 위한 표시
    }, { merge: true });
    hide('modal-confirm-delete-member');
    showToast('🗑️ 멤버와 모든 기록이 삭제되었습니다.');
    loadMembersTable();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 3500);
  }
});

// ── 유저 삭제 시 연관 데이터 전체 삭제 ──
async function deleteAllMemberRecords(uid) {
  // 1) 출석 기록
  const attSnap = await getDocs(query(collection(db, 'attendance'), where('uid', '==', uid)));
  await Promise.all(attSnap.docs.map(d => deleteDoc(d.ref)));

  // 2) 작사본 제출
  const lyricsSnap = await getDocs(query(collection(db, 'lyrics'), where('uid', '==', uid)));
  await Promise.all(lyricsSnap.docs.map(d => deleteDoc(d.ref)));

  // 3) 채팅방 (메시지 전체 + 채팅방 문서)
  const msgsSnap = await getDocs(collection(db, 'chats', uid, 'messages'));
  await Promise.all(msgsSnap.docs.map(d => deleteDoc(d.ref)));
  await deleteDoc(doc(db, 'chats', uid)).catch(() => {});

  // 4) 모든 공지의 댓글 중 이 유저가 작성한 것
  const noticesSnap = await getDocs(collection(db, 'notices'));
  for (const noticeDoc of noticesSnap.docs) {
    const commentsSnap = await getDocs(
      query(collection(db, 'notices', noticeDoc.id, 'comments'), where('uid', '==', uid))
    );
    await Promise.all(commentsSnap.docs.map(c => deleteDoc(c.ref)));
  }
}

// ── 멤버 기간제 차단 ──
['close-suspend-modal', 'cancel-suspend-member'].forEach(id => {
  $(id)?.addEventListener('click', () => hide('modal-suspend-member'));
});

$('confirm-suspend-member').addEventListener('click', async () => {
  const targetUid = $('modal-suspend-member').dataset.targetUid;
  if (!targetUid) return;
  if (targetUid === currentUser.uid) {
    showError('suspend-error', '본인 계정은 차단할 수 없습니다.');
    return;
  }
  const days = parseInt($('suspend-duration').value, 10);

  try {
    if (days === 0) {
      // 영구 차단
      await updateDoc(doc(db, 'users', targetUid), {
        suspendedUntil: 'permanent',
        suspendedAt: serverTimestamp(),
      });
    } else {
      const until = new Date(Date.now() + days * 86400000);
      await updateDoc(doc(db, 'users', targetUid), {
        suspendedUntil: Timestamp.fromDate(until),
        suspendedAt: serverTimestamp(),
      });
    }
    hide('modal-suspend-member');
    showToast('🚫 멤버가 차단되었습니다.');
    loadMembersTable();
  } catch (e) {
    showError('suspend-error', '차단 실패: ' + e.message);
  }
});



async function loadAdminAttendance() {
  const container = $('admin-attendance-list');
  container.innerHTML = '<div class="empty-state">로딩 중...</div>';

  const usersSnap = await getDocs(collection(db, 'users'));
  const attSnap   = await getDocs(collection(db, 'attendance'));

  const attByUser = {};
  attSnap.forEach(d => {
    const a = d.data();
    if (!attByUser[a.uid]) attByUser[a.uid] = [];
    attByUser[a.uid].push(a.date);
  });

  container.innerHTML = '';
  usersSnap.forEach(d => {
    const u = { id: d.id, ...d.data() };
    const dates = (attByUser[u.id] || []).sort().reverse();

    const block = document.createElement('div');
    block.className = 'admin-member-block';
    block.innerHTML = `
      <h4>
        ${u.name || u.email}
        <span class="badge badge-accent">${dates.length}일</span>
      </h4>
      <div class="attendance-dots">
        ${dates.length
          ? dates.map(d => `<div class="att-dot" title="${d}">${d.slice(8)}</div>`).join('')
          : '<span style="color:var(--text-mute);font-size:12px;">출석 기록 없음</span>'}
      </div>`;
    container.appendChild(block);
  });
}

async function loadAdminLyrics() {
  const container = $('admin-lyrics-list');
  container.innerHTML = '<div class="empty-state">로딩 중...</div>';

  const assignSnap  = await getDocs(collection(db, 'assignments'));
  const lyricsSnap  = await getDocs(collection(db, 'lyrics'));

  const lyricsByAssign = {};
  lyricsSnap.forEach(d => {
    const l = { id: d.id, ...d.data() };
    if (!lyricsByAssign[l.assignmentId]) lyricsByAssign[l.assignmentId] = [];
    lyricsByAssign[l.assignmentId].push(l);
  });

  container.innerHTML = '';
  if (assignSnap.empty) {
    container.innerHTML = '<div class="empty-state">등록된 과제가 없습니다.</div>';
    return;
  }

  assignSnap.forEach(d => {
    const a = { id: d.id, ...d.data() };
    const submissions = lyricsByAssign[a.id] || [];
    const block = document.createElement('div');
    block.className = 'admin-member-block';
    block.innerHTML = `
      <h4>
        ${a.topic}
        <span class="badge badge-muted">${submissions.length}개 제출</span>
      </h4>
      ${submissions.map(s => `
        <div style="margin-top:10px;">
          <div style="font-size:12px;color:var(--text-sub);margin-bottom:4px;">
            👤 ${s.userName} · ${formatDate(s.submittedAt)}
          </div>
          <div class="lyrics-submission">${s.content}</div>
        </div>
      `).join('') || '<div style="font-size:12px;color:var(--text-mute);margin-top:6px;">아직 제출 없음</div>'}`;
    container.appendChild(block);
  });
}

async function loadAlerts() {
  const list = $('inactive-members-list');
  list.innerHTML = '<div class="empty-state">로딩 중...</div>';

  const snap = await getDocs(collection(db, 'users'));
  const inactive = [];
  snap.forEach(d => {
    const u = { id: d.id, ...d.data() };
    if (daysDiff(u.lastSeen) >= 7) inactive.push(u);
  });

  if (!inactive.length) {
    list.innerHTML = '<div class="empty-state" style="color:var(--green)">⚠ 미접속 멤버가 없습니다 ✓</div>';
    return;
  }

  list.innerHTML = inactive.map(u => `
    <div class="log-item">
      <div>
        <div class="log-date">${u.name || u.email}</div>
        <div class="log-sub">${u.email}</div>
      </div>
      <span class="badge badge-red">${daysDiff(u.lastSeen)}일 미접속</span>
    </div>`).join('');
}

// 멤버 등록 (관리자)
$('btn-open-register')?.addEventListener('click', () => {
  $('admin-reg-name').value = '';
  $('admin-reg-email').value = '';
  $('admin-reg-password').value = '';
  $('admin-reg-role').value = 'user';
  hide('admin-register-error');
  show('modal-register-member');
  $('modal-register-member').classList.remove('hidden');
});

['close-register-modal', 'cancel-register-member'].forEach(id => {
  $(id)?.addEventListener('click', () => hide('modal-register-member'));
});

$('save-register-member').addEventListener('click', async () => {
  const name  = $('admin-reg-name').value.trim();
  const email = $('admin-reg-email').value.trim();
  const pw    = $('admin-reg-password').value;
  const role  = $('admin-reg-role').value;
  if (!name || !email || !pw) return showError('admin-register-error', '모든 필드를 입력하세요.');

  isRegisteringMember = true; // onAuthStateChanged의 부작용을 완전히 차단

  try {
    // 새 계정 생성 (이 작업은 현재 세션을 새 계정으로 자동 전환시킨다)
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    const newUid = cred.user.uid;

    // 이 시점의 세션은 이미 새로 만든 멤버 계정이지만,
    // 보안 규칙상 "본인 uid로 본인 문서 생성"은 허용되어 있어 정상적으로 기록된다.
    await setDoc(doc(db, 'users', newUid), {
      name,
      email,
      role,
      createdAt: serverTimestamp(),
    });

    // 새로 만든 멤버 계정에서 즉시 로그아웃 (onAuthStateChanged는 무시 상태이므로 화면 전환 없이 조용히 처리됨)
    await signOut(auth);

    hide('modal-register-member');
    showToast(`✅ ${name} 등록 완료. 자동으로 관리자 세션으로 복귀합니다.`, 3000);

    // 관리자 재로그인 — Firebase는 같은 탭에서 재로그인을 요구하므로,
    // 가장 안전한 방법은 관리자에게 다시 로그인하도록 안내하는 것이다.
    isRegisteringMember = false;
    showAuthScreen();
    $('login-email').value = '';
    $('login-password').value = '';
  } catch (e) {
    isRegisteringMember = false;
    showError('admin-register-error', getAuthError(e.code) || e.message);
  }
});

// ════════════════════════════════════════════════
//  PASSWORD CHANGE
// ════════════════════════════════════════════════
$('btn-change-password').addEventListener('click', async () => {
  hide('pw-change-error');
  hide('pw-change-success');

  const current  = $('current-password').value;
  const newPw    = $('new-password').value;
  const confirm  = $('confirm-password').value;

  if (!current || !newPw || !confirm)
    return showError('pw-change-error', '모든 필드를 입력하세요.');
  if (newPw !== confirm)
    return showError('pw-change-error', '새 비밀번호가 일치하지 않습니다.');
  if (newPw.length < 6)
    return showError('pw-change-error', '비밀번호는 최소 6자 이상이어야 합니다.');

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPw);
    show('pw-change-success');
    $('current-password').value = '';
    $('new-password').value = '';
    $('confirm-password').value = '';
    showToast('🔒 비밀번호가 변경되었습니다.');
  } catch (e) {
    showError('pw-change-error', getAuthError(e.code) || e.message);
  }
});
