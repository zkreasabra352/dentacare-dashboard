/* =========================================================
   DentaCare Dashboard — app.js
   ========================================================= */

// ---------- 1. Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyBvH5fBYRcMrFm35_c9CktSrzwzeWA___g",
  authDomain: "dentacare-dashboard.firebaseapp.com",
  databaseURL: "https://dentacare-dashboard-default-rtdb.firebaseio.com",
  projectId: "dentacare-dashboard",
  storageBucket: "dentacare-dashboard.firebasestorage.app",
  messagingSenderId: "453874581095",
  appId: "1:453874581095:web:7bce7a45caa9f4d601dec2",
  measurementId: "G-2B2QCQDDWW"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const TS = firebase.firestore.Timestamp;
const FV = firebase.firestore.FieldValue;

// ---------- 2. Settings ----------
const APPOINTMENT_GAP_MINUTES = 25;    // أقل فاصل بين موعدين

// ---------- 3. State ----------
let patientsData = [];
let currentPatient = null;       // { id, name, phone }
let recordsData = [];
let unsubPatients = null;
let unsubRecords = null;
let unsubSchedule = null;

let scheduleDate = startOfDay(new Date());
let scheduleItems = [];
let scheduleLoaded = false;

let editingRecord = null;        // { id, originalMinute }
let liveCheckToken = 0;

// ---------- 4. DOM ----------
const $ = (id) => document.getElementById(id);

const authScreen = $('auth-screen');
const dashboardScreen = $('dashboard-screen');
const loginForm = $('login-form');
const loginBtn = $('login-btn');
const loginError = $('login-error');
const logoutBtn = $('logout-btn');
const themeBtn = $('theme-btn');

const patientsList = $('patients-list');
const searchInput = $('search-input');
const searchClear = $('search-clear');
const patientsCount = $('patients-count');

const scheduleList = $('schedule-list');
const scheduleCount = $('schedule-count');

const patientModal = $('patient-modal');
const patientForm = $('patient-form');
const patientError = $('patient-error');
const patientSaveBtn = $('patient-save-btn');

const recordsModal = $('records-modal');
const recordsList = $('records-list');
const recordsSummary = $('records-summary');
const recordsCount = $('records-count');
const addRecordBtn = $('add-record-btn');
const recordForm = $('record-form');
const recordError = $('record-error');
const recordSaveBtn = $('record-save-btn');
const conflictBox = $('record-conflict');

const confirmModal = $('confirm-modal');
const toastContainer = $('toast-container');

// ---------- 5. Helpers ----------
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function formatMoney(amount, currency) {
  return `${numberFmt.format(amount)} ${currency || '$'}`;
}

function formatDate(ts) {
  if (!ts || typeof ts.toDate !== 'function') return 'غير محدد';
  return ts.toDate().toLocaleString('ar-EG-u-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatTime(date) {
  return date.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTimeShort(date) {
  return date.toLocaleString('ar-EG-u-nu-latn', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function pad(n) { return String(n).padStart(2, '0'); }

function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function roundUpMinutes(date, step = 5) {
  const ms = step * 60000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function minuteOf(date) {
  return Math.floor(date.getTime() / 60000);
}

function getInitial(name) {
  const trimmed = (name || '').trim();
  return trimmed ? Array.from(trimmed)[0] : '؟';
}

function avatarColor(name) {
  let hash = 0;
  for (const ch of name || '') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash}, 45%, 42%)`;
}

function cleanPhone(phone) {
  return (phone || '').replace(/[^\d+]/g, '');
}

function isNum(v) {
  return typeof v === 'number' && !Number.isNaN(v);
}

function patientNameById(id) {
  const p = patientsData.find((x) => x.id === id);
  return p ? p.name : 'مريض غير معروف';
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector('.btn-label').classList.toggle('hidden', loading);
  btn.querySelector('.spinner').classList.toggle('hidden', !loading);
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

function showErrorHtml(el, html) {
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

// رابط إنشاء الفهرس يأتي داخل رسالة خطأ Firestore
function indexLinkFromError(error) {
  const m = ((error && error.message) || '').match(/https:\/\/console\.firebase\.google\.com\/[^\s]+/);
  return m ? m[0] : null;
}

function indexHelpHtml(error) {
  const link = indexLinkFromError(error);
  return link
    ? `يلزم إنشاء فهرس في قاعدة البيانات لمرة واحدة. <a href="${escapeHtml(link)}" target="_blank" rel="noopener">اضغط هنا لإنشائه</a> ثم اضغط Save وانتظر دقيقة إلى أن يكتمل، وبعدها أعد المحاولة.`
    : 'يلزم إنشاء فهرس (Collection group) للحقل appointment في المجموعة records. راجع التعليمات المرفقة ثم أعد المحاولة.';
}

// ---------- 6. Toasts ----------
function showToast(message, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

// ---------- 7. Modals ----------
function openModal(modal) {
  modal.classList.add('active');
  document.body.classList.add('no-scroll');
}

function closeModal(modal) {
  modal.classList.remove('active');
  if (!document.querySelector('.modal.active')) {
    document.body.classList.remove('no-scroll');
  }
}

function closePatientModal() {
  closeModal(patientModal);
  patientForm.reset();
  hideError(patientError);
}

function closeRecordsModal() {
  closeModal(recordsModal);
  hideRecordForm();
  if (unsubRecords) { unsubRecords(); unsubRecords = null; }
  currentPatient = null;
  recordsData = [];
}

patientModal.querySelectorAll('.close-modal').forEach((b) => b.addEventListener('click', closePatientModal));
recordsModal.querySelectorAll('.close-modal').forEach((b) => b.addEventListener('click', closeRecordsModal));

[patientModal, recordsModal].forEach((modal) => {
  modal.addEventListener('mousedown', (e) => {
    if (e.target !== modal) return;
    modal === patientModal ? closePatientModal() : closeRecordsModal();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (confirmModal.classList.contains('active')) { $('confirm-cancel').click(); return; }
  if (patientModal.classList.contains('active')) closePatientModal();
  else if (recordsModal.classList.contains('active')) closeRecordsModal();
});

function confirmDialog({ title = 'تأكيد', message = '', okText = 'تأكيد' }) {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-ok').textContent = okText;
    openModal(confirmModal);

    const done = (result) => {
      closeModal(confirmModal);
      $('confirm-ok').removeEventListener('click', onOk);
      $('confirm-cancel').removeEventListener('click', onCancel);
      confirmModal.removeEventListener('mousedown', onBackdrop);
      resolve(result);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === confirmModal) done(false); };

    $('confirm-ok').addEventListener('click', onOk);
    $('confirm-cancel').addEventListener('click', onCancel);
    confirmModal.addEventListener('mousedown', onBackdrop);
  });
}

// ---------- 8. Theme ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeBtn.innerHTML = theme === 'dark'
    ? '<i class="fa-solid fa-sun"></i>'
    : '<i class="fa-solid fa-moon"></i>';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d1b24' : '#f1f7f9');
}

(function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('denta-theme') || 'dark'; } catch (e) { /* ignore */ }
  applyTheme(saved);
})();

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('denta-theme', next); } catch (e) { /* ignore */ }
});

// ---------- 9. Authentication ----------
const AUTH_ERRORS = {
  'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
  'auth/user-disabled': 'هذا الحساب معطّل.',
  'auth/user-not-found': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/wrong-password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
  'auth/network-request-failed': 'تعذّر الاتصال بالإنترنت. تحقق من الشبكة.'
};

auth.onAuthStateChanged((user) => {
  if (user) {
    authScreen.classList.remove('active');
    dashboardScreen.classList.add('active');
    loadPatientsRealtime();
    loadSchedule();
  } else {
    if (unsubPatients) { unsubPatients(); unsubPatients = null; }
    if (unsubRecords) { unsubRecords(); unsubRecords = null; }
    if (unsubSchedule) { unsubSchedule(); unsubSchedule = null; }
    patientsData = [];
    scheduleItems = [];
    scheduleLoaded = false;
    currentPatient = null;
    document.querySelectorAll('.modal.active').forEach((m) => m.classList.remove('active'));
    document.body.classList.remove('no-scroll');
    dashboardScreen.classList.remove('active');
    authScreen.classList.add('active');
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(loginError);

  const email = $('login-email').value.trim();
  const password = $('login-password').value;

  if (!email || !password) {
    showError(loginError, 'أدخل البريد الإلكتروني وكلمة المرور.');
    return;
  }

  setLoading(loginBtn, true);
  try {
    await auth.signInWithEmailAndPassword(email, password);
    loginForm.reset();
  } catch (error) {
    showError(loginError, AUTH_ERRORS[error.code] || 'تعذّر تسجيل الدخول. حاول مرة أخرى.');
  } finally {
    setLoading(loginBtn, false);
  }
});

$('toggle-password').addEventListener('click', () => {
  const input = $('login-password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggle-password').innerHTML = show
    ? '<i class="fa-regular fa-eye-slash"></i>'
    : '<i class="fa-regular fa-eye"></i>';
});

logoutBtn.addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'تسجيل الخروج',
    message: 'هل تريد تسجيل الخروج من لوحة التحكم؟',
    okText: 'خروج'
  });
  if (ok) auth.signOut();
});

// ---------- 10. Patients ----------
function showSkeleton() {
  patientsList.innerHTML = '<div class="skeleton"></div>'.repeat(4);
}

function loadPatientsRealtime() {
  if (unsubPatients) unsubPatients();
  showSkeleton();

  unsubPatients = db.collection('patients').orderBy('createdAt', 'desc').onSnapshot(
    (snapshot) => {
      patientsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      updateStats();
      applyFilter();
      renderSchedule();   // لتحديث أسماء المرضى في الجدول
    },
    (error) => {
      console.error('Error loading patients:', error);
      patientsList.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-cloud-bolt"></i>
          <h3>تعذّر تحميل المرضى</h3>
          <p>تحقق من الاتصال بالإنترنت وصلاحيات قاعدة البيانات.</p>
        </div>`;
      showToast('تعذّر تحميل قائمة المرضى', 'error');
    }
  );
}

function updateStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const newThisMonth = patientsData.filter((p) => {
    const d = p.createdAt && typeof p.createdAt.toDate === 'function' ? p.createdAt.toDate() : null;
    return d && d >= monthStart;
  }).length;

  $('stat-total').textContent = patientsData.length;
  $('stat-month').textContent = newThisMonth;
  $('stat-phone').textContent = patientsData.filter((p) => p.phone).length;
}

function applyFilter() {
  const query = searchInput.value.toLowerCase().trim();
  searchClear.classList.toggle('hidden', !query);

  const filtered = query
    ? patientsData.filter((p) =>
        (p.name || '').toLowerCase().includes(query) ||
        (p.phone && p.phone.replace(/\s/g, '').includes(query.replace(/\s/g, ''))))
    : patientsData;

  renderPatients(filtered, Boolean(query));
}

function renderPatients(patients, isSearch) {
  patientsCount.textContent = patients.length;

  if (patients.length === 0) {
    patientsList.innerHTML = isSearch
      ? `<div class="empty-state">
           <i class="fa-solid fa-magnifying-glass"></i>
           <h3>لا توجد نتائج</h3>
           <p>جرّب البحث باسم آخر أو رقم هاتف مختلف.</p>
         </div>`
      : `<div class="empty-state">
           <i class="fa-solid fa-user-plus"></i>
           <h3>لا يوجد مرضى بعد</h3>
           <p>أضف أول مريض لتبدأ بتسجيل المعالجات.</p>
           <button class="btn btn-primary" data-action="add"><i class="fa-solid fa-user-plus"></i> إضافة مريض</button>
         </div>`;
    return;
  }

  patientsList.innerHTML = patients.map((p) => {
    const name = escapeHtml(p.name);
    const phone = p.phone
      ? `<a class="patient-phone" href="tel:${escapeHtml(cleanPhone(p.phone))}"><i class="fa-solid fa-phone"></i> ${escapeHtml(p.phone)}</a>`
      : `<span class="patient-phone empty"><i class="fa-solid fa-phone-slash"></i> لا يوجد رقم</span>`;

    return `
      <article class="patient-card" data-id="${escapeHtml(p.id)}">
        <div class="patient-top">
          <div class="avatar" style="background:${avatarColor(p.name)}">${escapeHtml(getInitial(p.name))}</div>
          <div class="patient-meta">
            <h3 title="${name}">${name}</h3>
            ${phone}
          </div>
        </div>
        <div class="patient-actions">
          <button class="btn btn-primary btn-sm" data-action="records">
            <i class="fa-solid fa-folder-open"></i> السجل الطبي
          </button>
          <button class="icon-btn icon-btn-sm icon-btn-warn" data-action="edit" aria-label="تعديل المريض">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="icon-btn icon-btn-sm icon-btn-danger" data-action="delete" aria-label="حذف المريض">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </article>`;
  }).join('');
}

patientsList.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  if (action === 'add') { openPatientModal(); return; }

  const card = actionEl.closest('.patient-card');
  const patient = card && patientsData.find((p) => p.id === card.dataset.id);
  if (!patient) return;

  if (action === 'records') openRecordsModal(patient);
  else if (action === 'edit') openPatientModal(patient);
  else if (action === 'delete') deletePatient(patient);
});

searchInput.addEventListener('input', applyFilter);
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  applyFilter();
  searchInput.focus();
});

function openPatientModal(patient = null) {
  hideError(patientError);
  patientForm.reset();
  $('patient-id').value = patient ? patient.id : '';
  $('patient-modal-title').textContent = patient ? 'تعديل بيانات المريض' : 'إضافة مريض جديد';
  $('patient-name').value = patient ? patient.name : '';
  $('patient-phone').value = patient ? (patient.phone || '') : '';
  openModal(patientModal);
  setTimeout(() => $('patient-name').focus(), 150);
}

$('add-patient-btn').addEventListener('click', () => openPatientModal());
$('fab-add').addEventListener('click', () => openPatientModal());

patientForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(patientError);

  const id = $('patient-id').value;
  const name = $('patient-name').value.trim().replace(/\s+/g, ' ');
  const phone = $('patient-phone').value.trim();

  if (!name) {
    showError(patientError, 'اسم المريض مطلوب.');
    return;
  }

  const duplicate = patientsData.find((p) => (p.name || '').toLowerCase() === name.toLowerCase() && p.id !== id);
  if (duplicate) {
    showError(patientError, 'يوجد مريض مسجّل بهذا الاسم بالفعل.');
    return;
  }

  setLoading(patientSaveBtn, true);
  try {
    if (id) {
      await db.collection('patients').doc(id).update({ name, phone });
      showToast('تم تحديث بيانات المريض', 'success');
    } else {
      await db.collection('patients').add({ name, phone, createdAt: FV.serverTimestamp() });
      showToast('تمت إضافة المريض', 'success');
    }
    closePatientModal();
  } catch (error) {
    console.error(error);
    showError(patientError, 'حدث خطأ أثناء الحفظ. حاول مرة أخرى.');
  } finally {
    setLoading(patientSaveBtn, false);
  }
});

async function deletePatient(patient) {
  const ok = await confirmDialog({
    title: 'حذف المريض',
    message: `سيتم حذف "${patient.name}" وجميع سجلاته نهائياً. لا يمكن التراجع عن هذا الإجراء.`,
    okText: 'حذف نهائياً'
  });
  if (!ok) return;

  try {
    const patientRef = db.collection('patients').doc(patient.id);
    const recordsSnap = await patientRef.collection('records').get();
    const docs = recordsSnap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await patientRef.delete();
    showToast('تم حذف المريض', 'success');
  } catch (error) {
    console.error(error);
    showToast('حدث خطأ أثناء الحذف', 'error');
  }
}

// ---------- 11. Schedule (جدول المواعيد) ----------
function updateScheduleHeader() {
  const isToday = sameDay(scheduleDate, new Date());
  const label = scheduleDate.toLocaleDateString('ar-EG-u-nu-latn', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  $('schedule-date-label').textContent = (isToday ? 'اليوم — ' : '') + label;
  $('schedule-date').value = toDateInput(scheduleDate);
}

function loadSchedule() {
  if (unsubSchedule) unsubSchedule();
  scheduleLoaded = false;
  updateScheduleHeader();
  scheduleList.innerHTML = '<div class="skeleton" style="height:64px"></div>'.repeat(2);

  const start = new Date(scheduleDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  unsubSchedule = db.collectionGroup('records')
    .where('appointment', '>=', TS.fromDate(start))
    .where('appointment', '<', TS.fromDate(end))
    .orderBy('appointment', 'asc')
    .onSnapshot(
      (snapshot) => {
        scheduleItems = snapshot.docs.map((d) => ({
          id: d.id,
          patientId: d.ref.parent.parent.id,
          ...d.data()
        }));
        scheduleLoaded = true;
        renderSchedule();
      },
      (error) => {
        console.error('Schedule error:', error);
        scheduleCount.textContent = '0';
        scheduleList.innerHTML = error.code === 'failed-precondition'
          ? `<div class="conflict-box info">${indexHelpHtml(error)}</div>`
          : '<div class="schedule-empty"><i class="fa-solid fa-cloud-bolt"></i>تعذّر تحميل المواعيد.</div>';
      }
    );
}

function renderSchedule() {
  if (!scheduleLoaded) return;
  scheduleCount.textContent = scheduleItems.length;

  if (scheduleItems.length === 0) {
    scheduleList.innerHTML = `
      <div class="schedule-empty">
        <i class="fa-regular fa-calendar"></i>
        لا توجد مواعيد في هذا اليوم.
      </div>`;
    return;
  }

  const now = Date.now();
  const isToday = sameDay(scheduleDate, new Date());
  const nextIndex = isToday
    ? scheduleItems.findIndex((r) => r.appointment && r.appointment.toMillis() >= now)
    : -1;

  scheduleList.innerHTML = scheduleItems.map((r, i) => {
    const start = r.appointment.toDate();
    const isPast = isToday && r.appointment.toMillis() < now;

    const tags = [];
    if (i === nextIndex) tags.push('<span class="slot-tag next-tag">التالي</span>');
    if (isNum(r.cost)) {
      const due = Math.max(r.cost - (isNum(r.paid) ? r.paid : 0), 0);
      if (due > 0) tags.push(`<span class="slot-tag due-tag">متبقي ${escapeHtml(formatMoney(due, r.currency))}</span>`);
    }

    return `
      <div class="schedule-row ${isPast ? 'past' : ''} ${i === nextIndex ? 'next' : ''}"
           role="button" tabindex="0" data-patient="${escapeHtml(r.patientId)}">
        <div class="slot-time">${escapeHtml(formatTime(start))}</div>
        <div class="slot-body">
          <h4>${escapeHtml(patientNameById(r.patientId))}</h4>
          <p>${escapeHtml(r.treatmentType || '')}</p>
        </div>
        <div class="slot-side">${tags.join('')}</div>
      </div>`;
  }).join('');
}

function openScheduleRow(row) {
  const patient = patientsData.find((p) => p.id === row.dataset.patient);
  if (patient) openRecordsModal(patient);
  else showToast('لم يتم العثور على المريض', 'error');
}

scheduleList.addEventListener('click', (e) => {
  const row = e.target.closest('.schedule-row');
  if (row) openScheduleRow(row);
});
scheduleList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.schedule-row');
  if (row) { e.preventDefault(); openScheduleRow(row); }
});

function shiftScheduleDay(delta) {
  const d = new Date(scheduleDate);
  d.setDate(d.getDate() + delta);
  scheduleDate = startOfDay(d);
  loadSchedule();
}

$('schedule-prev').addEventListener('click', () => shiftScheduleDay(-1));
$('schedule-next').addEventListener('click', () => shiftScheduleDay(1));
$('schedule-today').addEventListener('click', () => { scheduleDate = startOfDay(new Date()); loadSchedule(); });
$('schedule-date').addEventListener('change', (e) => {
  if (!e.target.value) return;
  scheduleDate = startOfDay(new Date(`${e.target.value}T00:00:00`));
  loadSchedule();
});

// تحديث علامات "التالي" و"انتهى" كل دقيقة
setInterval(renderSchedule, 60000);

// ---------- 12. Appointment conflicts (تعارض المواعيد) ----------
function gapMs() { return APPOINTMENT_GAP_MINUTES * 60000; }

// كل المواعيد (لكل المرضى) التي تبعد أقل من 25 دقيقة عن الوقت المطلوب
async function queryAppointmentsAround(date, ignore) {
  const snap = await db.collectionGroup('records')
    .where('appointment', '>', TS.fromMillis(date.getTime() - gapMs()))
    .where('appointment', '<', TS.fromMillis(date.getTime() + gapMs()))
    .get();

  return snap.docs
    .filter((d) => !(ignore && d.id === ignore.recordId && d.ref.parent.parent.id === ignore.patientId))
    .map((d) => ({
      recordId: d.id,
      patientId: d.ref.parent.parent.id,
      start: d.data().appointment.toDate(),
      treatmentType: d.data().treatmentType || ''
    }));
}

// أقرب وقت متاح بعد آخر موعد متعارض
async function findNextFreeSlot(startConflicts, ignore) {
  let conflicts = startConflicts;
  for (let i = 0; i < 10; i++) {
    const last = Math.max(...conflicts.map((c) => c.start.getTime()));
    const candidate = new Date(Math.ceil((last + gapMs()) / 60000) * 60000);
    conflicts = await queryAppointmentsAround(candidate, ignore);
    if (!conflicts.length) return candidate;
  }
  return null;
}

async function checkAppointment(date, ignore) {
  const conflicts = await queryAppointmentsAround(date, ignore);
  if (!conflicts.length) return { conflicts: [], suggestion: null };
  const suggestion = await findNextFreeSlot(conflicts, ignore);
  return { conflicts, suggestion };
}

function currentIgnore() {
  return editingRecord && currentPatient
    ? { recordId: editingRecord.id, patientId: currentPatient.id }
    : null;
}

function renderConflict(conflicts, suggestion) {
  const items = [...conflicts]
    .sort((a, b) => a.start - b.start)
    .map((c) => {
      const same = currentPatient && c.patientId === currentPatient.id ? ' (نفس المريض)' : '';
      const treat = c.treatmentType ? ` — ${escapeHtml(c.treatmentType)}` : '';
      return `<li><i class="fa-regular fa-clock"></i> <b>${escapeHtml(patientNameById(c.patientId))}</b>${same} الساعة ${escapeHtml(formatTime(c.start))}${treat}</li>`;
    }).join('');

  const suggestBtn = suggestion
    ? `<button type="button" class="btn btn-primary btn-sm" data-suggest="${toLocalInput(suggestion)}">
         <i class="fa-regular fa-clock"></i> استخدم أقرب وقت متاح: ${escapeHtml(formatDateTimeShort(suggestion))}
       </button>`
    : '';

  conflictBox.classList.remove('info');
  conflictBox.innerHTML = `
    <strong><i class="fa-solid fa-triangle-exclamation"></i> هذا الوقت محجوز</strong>
    <ul>${items}</ul>
    <span>يجب ترك ${APPOINTMENT_GAP_MINUTES} دقيقة على الأقل بين كل موعدين.</span>
    ${suggestBtn ? '<br>' + suggestBtn : ''}`;
  conflictBox.classList.remove('hidden');
}

function hideConflict() {
  conflictBox.innerHTML = '';
  conflictBox.classList.add('hidden');
}

conflictBox.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-suggest]');
  if (!btn) return;
  $('appointment-date').value = btn.dataset.suggest;
  hideConflict();
  hideError(recordError);
  showToast('تم اختيار الوقت المتاح', 'success');
});

// فحص فوري عند تغيير الموعد (للتنبيه فقط، والمنع الفعلي يتم عند الحفظ)
async function liveCheck() {
  const value = $('appointment-date').value;
  if (!value || !currentPatient) { hideConflict(); return; }

  const date = new Date(value);
  if (editingRecord && editingRecord.originalMinute === minuteOf(date)) { hideConflict(); return; }

  const token = ++liveCheckToken;
  try {
    const res = await checkAppointment(date, currentIgnore());
    if (token !== liveCheckToken) return;
    if (res.conflicts.length) renderConflict(res.conflicts, res.suggestion);
    else hideConflict();
  } catch (error) {
    // يُعالَج عند الحفظ
    console.warn('Live check failed:', error);
  }
}

$('appointment-date').addEventListener('change', liveCheck);

// ---------- 13. Medical Records ----------
function openRecordsModal(patient) {
  currentPatient = { id: patient.id, name: patient.name, phone: patient.phone || '' };

  $('records-patient-name').textContent = `السجل الطبي: ${patient.name}`;

  const phoneEl = $('records-patient-phone');
  if (patient.phone) {
    phoneEl.innerHTML = `<i class="fa-solid fa-phone"></i> ${escapeHtml(patient.phone)}`;
    phoneEl.href = `tel:${cleanPhone(patient.phone)}`;
    phoneEl.classList.remove('hidden');
  } else {
    phoneEl.classList.add('hidden');
  }

  hideRecordForm();
  recordsList.innerHTML = '<div class="skeleton" style="height:96px"></div>'.repeat(2);
  recordsSummary.classList.add('hidden');
  recordsCount.textContent = '0';
  openModal(recordsModal);
  loadRecords(patient.id);
}

function loadRecords(patientId) {
  if (unsubRecords) unsubRecords();

  unsubRecords = db.collection('patients').doc(patientId).collection('records')
    .orderBy('appointment', 'desc')
    .onSnapshot(
      (snapshot) => {
        recordsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderRecords();
      },
      (error) => {
        console.error('Error loading records:', error);
        recordsList.innerHTML = '<p class="subtitle" style="text-align:center">تعذّر تحميل السجلات.</p>';
      }
    );
}

function renderSummary() {
  const totals = {};
  recordsData.forEach((r) => {
    if (!isNum(r.cost)) return;
    const cur = r.currency || '$';
    totals[cur] = totals[cur] || { cost: 0, paid: 0 };
    totals[cur].cost += r.cost;
    totals[cur].paid += isNum(r.paid) ? r.paid : 0;
  });

  const currencies = Object.keys(totals);
  if (currencies.length === 0) {
    recordsSummary.classList.add('hidden');
    return;
  }

  recordsSummary.innerHTML = currencies.map((cur) => {
    const t = totals[cur];
    const due = Math.max(t.cost - t.paid, 0);
    return `
      ${currencies.length > 1 ? `<div class="summary-title">الحساب بعملة ${escapeHtml(cur)}</div>` : ''}
      <div class="sum-box"><span>الإجمالي</span><strong>${formatMoney(t.cost, cur)}</strong></div>
      <div class="sum-box sum-paid"><span>المدفوع</span><strong>${formatMoney(t.paid, cur)}</strong></div>
      <div class="sum-box sum-due ${due === 0 ? 'settled' : ''}"><span>المتبقي</span><strong>${formatMoney(due, cur)}</strong></div>`;
  }).join('');
  recordsSummary.classList.remove('hidden');
}

function renderRecords() {
  recordsCount.textContent = recordsData.length;
  renderSummary();

  if (recordsData.length === 0) {
    recordsList.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-notes-medical"></i>
        <h3>لا توجد معالجات بعد</h3>
        <p>اضغط "إضافة معالجة" لتسجيل أول معالجة لهذا المريض.</p>
      </div>`;
    return;
  }

  recordsList.innerHTML = recordsData.map((r) => {
    let moneyHtml = '';

    if (isNum(r.cost)) {
      const cur = r.currency || '$';
      const paid = isNum(r.paid) ? r.paid : 0;
      const due = Math.max(r.cost - paid, 0);

      let badge;
      if (due === 0) badge = '<span class="badge badge-ok"><i class="fa-solid fa-circle-check"></i> مدفوع بالكامل</span>';
      else if (paid > 0) badge = '<span class="badge badge-part"><i class="fa-solid fa-hourglass-half"></i> دفعة جزئية</span>';
      else badge = '<span class="badge badge-none"><i class="fa-solid fa-circle-xmark"></i> غير مدفوع</span>';

      moneyHtml = `
        <div class="record-money">
          <div><span>التكلفة</span><strong>${formatMoney(r.cost, cur)}</strong></div>
          <div><span>المدفوع</span><strong>${formatMoney(paid, cur)}</strong></div>
          <div><span>المتبقي</span><strong>${formatMoney(due, cur)}</strong></div>
        </div>
        ${badge}`;
    } else {
      moneyHtml = `
        <div class="record-legacy">
          <span><strong>التكلفة:</strong> ${escapeHtml(r.cost || 'غير محدد')}</span>
          <span><strong>الدفعات:</strong> ${escapeHtml(r.payments || 'غير محدد')}</span>
        </div>`;
    }

    return `
      <article class="record-item" data-id="${escapeHtml(r.id)}">
        <div class="record-header">
          <div>
            <span class="record-title">${escapeHtml(r.treatmentType)}</span>
            <span class="record-date"><i class="fa-regular fa-clock"></i> ${escapeHtml(formatDate(r.appointment))}</span>
          </div>
          <div class="record-tools">
            <button class="icon-btn icon-btn-sm icon-btn-warn" data-action="edit-record" aria-label="تعديل المعالجة"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn icon-btn-sm icon-btn-danger" data-action="delete-record" aria-label="حذف المعالجة"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        ${moneyHtml}
        ${r.note ? `<div class="record-note">${escapeHtml(r.note)}</div>` : ''}
      </article>`;
  }).join('');

}

recordsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const item = btn.closest('.record-item');
  const record = item && recordsData.find((r) => r.id === item.dataset.id);
  if (!record) return;

  switch (btn.dataset.action) {
    case 'edit-record': showRecordForm(record); break;
    case 'delete-record': deleteRecord(record); break;
    default: break;
  }
});

// ----- نموذج المعالجة -----
function showRecordForm(record = null) {
  hideError(recordError);
  hideConflict();
  recordForm.reset();

  const apTs = record && record.appointment && record.appointment.toDate ? record.appointment : null;
  editingRecord = record
    ? { id: record.id, originalMinute: apTs ? minuteOf(apTs.toDate()) : null }
    : null;

  $('record-id').value = record ? record.id : '';
  $('record-form-title').textContent = record ? 'تعديل المعالجة' : 'معالجة جديدة';
  recordSaveBtn.querySelector('.btn-label').textContent = record ? 'حفظ التعديلات' : 'حفظ المعالجة';

  if (record) {
    $('treatment-type').value = record.treatmentType || '';
    $('cost').value = isNum(record.cost) ? record.cost : '';
    $('paid').value = isNum(record.paid) ? record.paid : '';
    $('currency').value = record.currency || '$';
    $('record-note').value = record.note || '';
    $('appointment-date').value = apTs ? toLocalInput(apTs.toDate()) : toLocalInput(new Date());
  } else {
    $('appointment-date').value = toLocalInput(roundUpMinutes(new Date(), 5));
  }

  recordForm.classList.remove('hidden');
  addRecordBtn.classList.add('hidden');
  recordForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => $('treatment-type').focus({ preventScroll: true }), 250);

  if (!record) liveCheck();
}

function hideRecordForm() {
  recordForm.classList.add('hidden');
  addRecordBtn.classList.remove('hidden');
  recordForm.reset();
  hideError(recordError);
  hideConflict();
  editingRecord = null;
  liveCheckToken++;
}

addRecordBtn.addEventListener('click', () => showRecordForm());
$('record-cancel').addEventListener('click', hideRecordForm);

recordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(recordError);
  if (!currentPatient) return;

  const recordId = $('record-id').value;
  const treatmentType = $('treatment-type').value.trim();
  const costRaw = $('cost').value;
  const paidRaw = $('paid').value;
  const currency = $('currency').value;
  const note = $('record-note').value.trim();
  const appointmentInput = $('appointment-date').value;

  if (!treatmentType) { showError(recordError, 'اكتب نوع المعالجة.'); return; }

  const cost = parseFloat(costRaw);
  const paid = paidRaw === '' ? 0 : parseFloat(paidRaw);

  if (Number.isNaN(cost) || cost < 0) { showError(recordError, 'أدخل تكلفة صحيحة.'); return; }
  if (Number.isNaN(paid) || paid < 0) { showError(recordError, 'أدخل مبلغاً مدفوعاً صحيحاً.'); return; }
  if (paid > cost) { showError(recordError, 'المبلغ المدفوع أكبر من التكلفة.'); return; }
  if (!appointmentInput) { showError(recordError, 'اختر موعد المعالجة.'); return; }

  const appointmentDate = new Date(appointmentInput);
  const timeChanged = !editingRecord || editingRecord.originalMinute !== minuteOf(appointmentDate);

  setLoading(recordSaveBtn, true);
  try {
    // 1) التحقق من تعارض المواعيد (لكل المرضى)
    if (timeChanged) {
      let result;
      try {
        result = await checkAppointment(appointmentDate, currentIgnore());
      } catch (error) {
        console.error('Conflict check failed:', error);
        showErrorHtml(
          recordError,
          error.code === 'failed-precondition'
            ? indexHelpHtml(error)
            : 'تعذّر التحقق من توفر الموعد. تحقق من الاتصال ثم أعد المحاولة.'
        );
        return;
      }
      if (result.conflicts.length) {
        renderConflict(result.conflicts, result.suggestion);
        conflictBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    hideConflict();

    // 2) حفظ المعالجة
    const recordsRef = db.collection('patients').doc(currentPatient.id).collection('records');
    const payload = { treatmentType, cost, paid, currency, note };
    if (timeChanged) payload.appointment = TS.fromDate(appointmentDate);

    if (recordId) {
      await recordsRef.doc(recordId).update({ ...payload, payments: FV.delete() });
      showToast('تم تحديث المعالجة', 'success');
    } else {
      await recordsRef.add({ ...payload, createdAt: FV.serverTimestamp() });
      showToast('تمت إضافة المعالجة', 'success');
    }

    hideRecordForm();
  } catch (error) {
    console.error(error);
    showError(recordError, 'حدث خطأ أثناء الحفظ. حاول مرة أخرى.');
  } finally {
    setLoading(recordSaveBtn, false);
  }
});

async function deleteRecord(record) {
  const ok = await confirmDialog({
    title: 'حذف المعالجة',
    message: `هل تريد حذف معالجة "${record.treatmentType}"؟`,
    okText: 'حذف'
  });
  if (!ok || !currentPatient) return;

  try {
    const ref = db.collection('patients').doc(currentPatient.id).collection('records').doc(record.id);
    await ref.delete();
    showToast('تم حذف المعالجة', 'success');
  } catch (error) {
    console.error(error);
    showToast('تعذّر حذف المعالجة', 'error');
  }
}
