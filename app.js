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
  if (user) {
    currentUser = user;
    await loadProfile(user.uid);
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
  } else {
    // 프로필이 없으면 기본 생성
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

  // 기본 페이지 로드
  navigateTo('attendance');
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
  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-mute)">로딩 중...</td></tr>';
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
  if (snap.empty) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">멤버 없음</td></tr>'; return; }

  tbody.innerHTML = '';
  snap.forEach(d => {
    const u = d.data();
    const inactive = daysDiff(u.lastSeen) >= 7;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.name || '—'}</td>
      <td style="color:var(--text-sub)">${u.email || '—'}</td>
      <td><span class="badge ${u.role === 'admin' ? 'badge-accent' : 'badge-muted'}">${u.role === 'admin' ? '관리자' : '멤버'}</span></td>
      <td style="color:var(--text-sub)">${formatDate(u.createdAt)}</td>
      <td style="color:var(--text-sub)">${formatDate(u.lastSeen)}</td>
      <td><span class="badge ${inactive ? 'badge-red' : 'badge-green'}">${inactive ? '미접속' : '활성'}</span></td>`;
    tbody.appendChild(tr);
  });
}

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

  try {
    // 현재 관리자 자격증명 저장
    const adminEmail = currentUser.email;
    const adminUid   = currentUser.uid;

    // 새 계정 생성 (이 작업은 현재 세션을 변경함)
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    const newUid = cred.user.uid;

    await setDoc(doc(db, 'users', newUid), {
      name,
      email,
      role,
      createdAt: serverTimestamp(),
    });

    // 관리자 계정으로 재로그인 필요 알림
    hide('modal-register-member');
    showToast(`✅ ${name} 등록 완료. 다시 로그인해주세요.`, 4000);
    setTimeout(() => signOut(auth), 2000);
  } catch (e) {
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
