const statusEl = document.getElementById('status');
const formEl = document.getElementById('requestForm');
const filesHintEl = document.getElementById('filesHint');
const submitBtn = document.getElementById('submitBtn');
const installBtn = document.getElementById('installBtn');
const offlineBadge = document.getElementById('offlineBadge');
const netIndicatorEl = document.getElementById('netIndicator');
const queueListEl = document.getElementById('queueList');
const queueEmptyEl = document.getElementById('queueEmpty');
const flushQueueBtn = document.getElementById('flushQueueBtn');
const chooseProblemBtn = document.getElementById('chooseProblemBtn');
const problemGridEl = document.getElementById('problemGrid');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const photoBarcodeBlockEl = document.getElementById('photoBarcodeBlock');
const photoBarcodeBlockWrapEl = document.getElementById('photoBarcodeBlockWrap');
const attachmentsEl = document.getElementById('boxAttachments');
const barcodeNotScanningDetailsEl = document.getElementById('barcodeNotScanningDetails');
const calcSgBtn = document.getElementById('calcSgBtn');
const sgPercentEl = document.getElementById('sgPercent');
const expiryDateOutEl = document.getElementById('expiryDateOut');
const toastHostEl = document.getElementById('toastHost');
const successModalEl = document.getElementById('successModal');
const successModalOkBtn = document.getElementById('successModalOkBtn');

let currentRequestId_ = '';

const CONFIG = {
  // For GitHub Pages (static hosting), submit directly to Google Apps Script Web App.
  // Use Content-Type: text/plain to avoid CORS preflight.
  submitUrl: 'https://script.google.com/macros/s/AKfycbwR70njJu1aRLypsx1T3FtRHPvRw68da6Hw2U2ZwYxMsRKkuRPCIIJyyeTNAHFUhYgt1A/exec'
};

function setStatus(text, { error = false } = {}) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

function openSuccessModal_() {
  if (!successModalEl) return;
  successModalEl.hidden = false;
}

function closeSuccessModal_() {
  if (!successModalEl) return;
  successModalEl.hidden = true;
}

function toast_(message, { type = 'info', timeoutMs = 3800 } = {}) {
  if (!toastHostEl) {
    if (type === 'error') setStatus(message, { error: true });
    else setStatus(message);
    return;
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = String(message || '');
  toastHostEl.appendChild(el);
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, timeoutMs);
}

function updateOffline() {
  const offline = !navigator.onLine;
  offlineBadge.hidden = !offline;
  if (netIndicatorEl) netIndicatorEl.classList.toggle('online', !offline);
}

async function fileToBase64(file) {
  const ab = await file.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function sanitizeDigitsOnly(value) {
  return value.replace(/\D+/g, '');
}

function sanitizeNumberOnly(value) {
  const v = value.replace(/,/g, '.');
  return v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

function sanitizeDotDecimalOnly(value) {
  const v = String(value ?? '');
  // only digits and a single dot
  return v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

function parseDigitsOnlyNumber(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDotDecimalNumber(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (!/^\d+(?:\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseNumber(value) {
  const v = String(value ?? '').trim().replace(/,/g, '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntStrict(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

document.querySelectorAll('[data-digits-only="true"]').forEach((el) => {
  el.addEventListener('input', () => {
    const before = String(el.value || '');
    const after = sanitizeDigitsOnly(before);
    if (before !== after && (el.name === 'd_cm' || el.name === 'w_cm' || el.name === 'h_cm')) {
      toast_('Длина/Ширина/Высота: вводите только цифры (без точек и запятых).', { type: 'warning' });
    }
    el.value = after;
  });
});

// weight_kg: allow decimals with DOT only
document.querySelectorAll('input[name="weight_kg"]').forEach((el) => {
  el.addEventListener('input', () => {
    const before = String(el.value || '');
    if (/,/.test(before)) {
      toast_('Вес: используйте точку, например 1.5 (запятая запрещена).', { type: 'warning' });
    }
    const after = sanitizeDotDecimalOnly(before);
    if (before !== after && /[^0-9.,]/.test(before)) {
      toast_('Вес: можно вводить только цифры и точку.', { type: 'warning' });
    }
    el.value = after;
  });
});

document.querySelectorAll('[data-number-only="true"]').forEach((el) => {
  el.addEventListener('input', () => {
    el.value = sanitizeNumberOnly(el.value);
  });
});

attachmentsEl.addEventListener('change', () => {
  const files = Array.from(attachmentsEl.files || []);
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  if (!files.length) {
    filesHintEl.textContent = '';
    return;
  }
  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  filesHintEl.textContent = `Выбрано вложений: ${files.length}, общий размер: ${mb} MB`;
});

function setBlockPhotoRequired(required) {
  if (!photoBarcodeBlockEl || !photoBarcodeBlockWrapEl) return;
  photoBarcodeBlockWrapEl.hidden = !required;
  photoBarcodeBlockEl.required = Boolean(required);
  if (!required) photoBarcodeBlockEl.value = '';
}

function getTpr2Value_() {
  const fd = new FormData(formEl);
  const tpr2 = parseIntStrict(fd.get('tpr2'));
  if (tpr2 == null) return null;
  if (tpr2 <= 0) return null;
  return tpr2;
}

function syncBlockPhotoVisibility() {
  setBlockPhotoRequired(Boolean(getTpr2Value_()));
}

formEl.querySelector('input[name="tpr2"]')?.addEventListener('input', syncBlockPhotoVisibility);
syncBlockPhotoVisibility();

function getSelectedProblem() {
  const el = document.querySelector('input[name="problem"]:checked');
  return el ? String(el.value) : '';
}

function getSelectedProblemLabel_() {
  const el = document.querySelector('input[name="problem"]:checked');
  if (!el) return '';
  const label = el.closest('label');
  const textEl = label ? label.querySelector('.problemText') : null;
  return textEl ? String(textEl.textContent || '').trim() : '';
}

function syncProblemButtonLabel_() {
  if (!chooseProblemBtn) return;
  const lbl = getSelectedProblemLabel_();
  chooseProblemBtn.textContent = lbl ? `Проблема: ${lbl}` : 'Выбрать проблему';
}

function syncProblemDetails() {
  const v = getSelectedProblem();
  barcodeNotScanningDetailsEl.hidden = v !== 'barcode_not_scanning';
  const reasonSelect = barcodeNotScanningDetailsEl.querySelector('select[name="barcode_not_scanning_reason"]');
  if (reasonSelect) reasonSelect.required = v === 'barcode_not_scanning';
}

document.querySelectorAll('input[name="problem"]').forEach((el) => {
  el.addEventListener('change', syncProblemDetails);
  el.addEventListener('change', () => {
    syncProblemButtonLabel_();
    if (problemGridEl) problemGridEl.hidden = true;
  });
});
syncProblemDetails();
syncProblemButtonLabel_();

chooseProblemBtn?.addEventListener('click', () => {
  if (!problemGridEl) return;
  problemGridEl.hidden = !problemGridEl.hidden;
});

function toDateOnly_(d) {
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function computeSgPercent_({ mfgDate, expiryDate, shelfLifeDays }) {
  const mfg = toDateOnly_(mfgDate);
  if (!mfg) return null;

  let exp = toDateOnly_(expiryDate);
  if (!exp && Number.isFinite(shelfLifeDays) && shelfLifeDays > 0) {
    exp = new Date(mfg.getTime());
    exp.setDate(exp.getDate() + shelfLifeDays);
  }
  if (!exp) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const total = exp.getTime() - mfg.getTime();
  if (total <= 0) return 0;
  const left = exp.getTime() - now.getTime();
  const pct = (left / total) * 100;
  return Math.max(0, Math.min(100, pct));
}

calcSgBtn?.addEventListener('click', () => {
  const fd = new FormData(formEl);
  const mfgDate = String(fd.get('mfg_date') || '');
  const sgDays = parseIntStrict(fd.get('sg_days')) ?? null;
  const pct = computeSgPercent_({ mfgDate, expiryDate: '', shelfLifeDays: sgDays });
  if (pct == null) {
    toast_('Для расчёта СГ% укажите дату изготовления и срок годности (дней).', { type: 'error' });
    return;
  }
  sgPercentEl.value = pct.toFixed(1);

  // expiry date = mfg + sg_days
  if (expiryDateOutEl && Number.isFinite(sgDays) && sgDays > 0) {
    const mfg = toDateOnly_(mfgDate);
    if (mfg) {
      const exp = new Date(mfg.getTime());
      exp.setDate(exp.getDate() + sgDays);
      const dd = String(exp.getDate()).padStart(2, '0');
      const mm = String(exp.getMonth() + 1).padStart(2, '0');
      const yyyy = exp.getFullYear();
      expiryDateOutEl.value = `${dd}.${mm}.${yyyy}`;
    }
  }
  toast_('СГ% рассчитан.', { type: 'success' });
});

let deferredPrompt = null;
function isStandalone_() {
  return Boolean(
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    // iOS Safari
    (window.navigator && window.navigator.standalone)
  );
}

function isIos_() {
  const ua = String(navigator.userAgent || '');
  return /iPad|iPhone|iPod/i.test(ua);
}

function isMobile_() {
  const ua = String(navigator.userAgent || '');
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

function syncInstallUi_() {
  if (!installBtn) return;
  if (isStandalone_()) {
    installBtn.hidden = true;
    return;
  }
  // Show on both desktop and mobile; hide only when already installed (standalone)
  installBtn.hidden = false;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  syncInstallUi_();
});

installBtn.addEventListener('click', async () => {
  if (isStandalone_()) {
    installBtn.hidden = true;
    return;
  }

  if (deferredPrompt) {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice && choice.outcome === 'accepted') {
      toast_('Установка запущена.', { type: 'success' });
      installBtn.hidden = true;
      return;
    }
    toast_('Установка отменена. Кнопка останется доступной.', { type: 'warning' });
    syncInstallUi_();
    return;
  }

  if (isIos_()) {
    toast_('iPhone/iPad: нажмите «Поделиться» → «На экран Домой» для установки.', { type: 'info', timeoutMs: 6000 });
    return;
  }

  toast_('Установка недоступна сейчас. Откройте сайт в Chrome и попробуйте снова.', { type: 'warning', timeoutMs: 5200 });
});

window.addEventListener('appinstalled', () => {
  toast_('Приложение установлено.', { type: 'success' });
  if (installBtn) installBtn.hidden = true;
});

syncInstallUi_();

window.addEventListener('online', updateOffline);
window.addEventListener('offline', updateOffline);
updateOffline();

// ===== Offline queue (IndexedDB) =====
const DB_NAME = 'vgh_pwa';
const DB_VERSION = 1;
const STORE_QUEUE = 'queue';

function openDb_() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore_(mode, fn) {
  const db = await openDb_();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, mode);
    const store = tx.objectStore(STORE_QUEUE);
    const out = fn(store);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

async function queueAdd_(payload) {
  // Deduplicate by requestId (avoid multiple clicks when offline)
  const requestId = payload && payload.requestId ? String(payload.requestId) : '';
  if (requestId) {
    const existing = await queueGetAll_().catch(() => []);
    const has = existing.some((x) => x && x.payload && String(x.payload.requestId || '') === requestId);
    if (has) return;
  }
  const item = {
    createdAt: new Date().toISOString(),
    payload,
    attempts: 0,
    lastError: ''
  };
  await withStore_('readwrite', (store) => store.add(item));
  await renderQueue_();
}

async function queueGetAll_() {
  const db = await openDb_();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function queueDelete_(id) {
  await withStore_('readwrite', (store) => store.delete(id));
  await renderQueue_();
}

async function queueUpdate_(item) {
  await withStore_('readwrite', (store) => store.put(item));
  await renderQueue_();
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createRequestId_() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getOrCreateRequestId_() {
  if (!currentRequestId_) currentRequestId_ = createRequestId_();
  return currentRequestId_;
}

function resetRequestId_() {
  currentRequestId_ = '';
}

async function renderQueue_() {
  if (!queueListEl || !queueEmptyEl) return;
  const items = await queueGetAll_().catch(() => []);
  queueEmptyEl.hidden = items.length !== 0;
  queueListEl.innerHTML = '';

  for (const item of items) {
    const p = item.payload || {};
    const top = `${p.supplier || ''} / ЛК ${p.lk || ''}`.trim() || `Заявка #${item.id}`;
    const sub = `${item.createdAt}${item.lastError ? ` • Ошибка: ${item.lastError}` : ''}`;

    const li = document.createElement('li');
    li.className = 'queueItem';
    li.innerHTML = `
      <div class="queueMeta">
        <div class="top">${escapeHtml_(top)}</div>
        <div class="sub">${escapeHtml_(sub)}</div>
      </div>
      <div class="queueActions">
        <button class="queueBtn" data-action="send" data-id="${item.id}">Отправить</button>
        <button class="queueBtn" data-action="del" data-id="${item.id}">Удалить</button>
      </div>
    `;
    queueListEl.appendChild(li);
  }
}

function isNetworkError_(err) {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const msg = String(err && err.message ? err.message : err);
  return /failed to fetch|networkerror|fetch failed|load failed/i.test(msg);
}

async function sendPayload_(payload) {
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(CONFIG.submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body
    });

    const responseText = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}\n${responseText}`.trim());
    }
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
      data = null;
    }
    if (data && data.ok === false && data.error) {
      throw new Error(String(data.error));
    }
    if (!data || data.ok !== true) {
      throw new Error(`Ответ сервера не JSON/ok=true\n${responseText}`.trim());
    }
    return data;
  } catch (err) {
    // GitHub Pages -> script.google.com часто блокируется CORS. В этом случае
    // используем sendBeacon (не требует CORS, ответа нет).
    if (err instanceof TypeError) {
      try {
        if (navigator && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
          const ok = navigator.sendBeacon(CONFIG.submitUrl, blob);
          if (ok) return { ok: true, beacon: true };
        }
      } catch (_) {}

      // Secondary attempt: no-cors. Не считаем успехом, если браузер всё равно ошибся.
      try {
        const res2 = await fetch(CONFIG.submitUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body
        });
        if (res2 && res2.type === 'opaque') {
          return { ok: true, opaque: true };
        }
      } catch (_) {}
    }
    throw err;
  }
}

async function flushQueue_() {
  if (!navigator.onLine) return;
  if (flushQueue_.inProgress) return;
  flushQueue_.inProgress = true;
  try {
  const items = await queueGetAll_().catch(() => []);
  if (items.length) toast_('Очередь отправляется...', { type: 'info', timeoutMs: 2200 });
  for (const item of items) {
    try {
      await sendPayload_(item.payload);
      await queueDelete_(item.id);
    } catch (err) {
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastError = err instanceof Error ? err.message : String(err);
      await queueUpdate_(item);
      if (isNetworkError_(err)) return;
    }
  }
  } finally {
    flushQueue_.inProgress = false;
  }
}

queueListEl?.addEventListener('click', async (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const id = Number(btn.getAttribute('data-id'));
  if (!Number.isFinite(id)) return;

  if (action === 'del') {
    await queueDelete_(id);
  }
  if (action === 'send') {
    const items = await queueGetAll_().catch(() => []);
    const item = items.find((x) => Number(x.id) === id);
    if (!item) return;
    try {
      await sendPayload_(item.payload);
      await queueDelete_(id);
      setStatus('Элемент очереди отправлен.');
    } catch (err) {
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastError = err instanceof Error ? err.message : String(err);
      await queueUpdate_(item);
      setStatus(item.lastError, { error: true });
    }
  }
});

flushQueueBtn?.addEventListener('click', async () => {
  await flushQueue_();
});

window.addEventListener('online', () => {
  flushQueue_();
});

renderQueue_();

successModalOkBtn?.addEventListener('click', () => {
  closeSuccessModal_();
});

successModalEl?.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute('data-action') === 'close') {
    closeSuccessModal_();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');

      // If there's an updated SW waiting, activate it immediately
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // Reload when new SW takes control
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        setTimeout(() => window.location.reload(), 150);
      });
    } catch (_) {
    }
  });
}

async function hardReload_() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) {}
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (_) {}
  window.location.reload();
}

clearCacheBtn?.addEventListener('click', async () => {
  toast_('Сброс кеша...', { type: 'warning', timeoutMs: 1600 });
  await hardReload_();
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  toast_('Отправка...', { type: 'info', timeoutMs: 1600 });
  submitBtn.disabled = true;
  document.body.classList.add('submitting');

  try {
    if (!CONFIG.submitUrl) {
      throw new Error('Не задан URL отправки.');
    }

    const fd = new FormData(formEl);

    const requestId = getOrCreateRequestId_();

    const dCm = parseIntStrict(fd.get('d_cm'));
    const wCm = parseIntStrict(fd.get('w_cm'));
    const hCm = parseIntStrict(fd.get('h_cm'));
    const weightKg = parseDotDecimalNumber(fd.get('weight_kg'));
    const sgDays = parseIntStrict(fd.get('sg_days'));
    const tpr2 = getTpr2Value_();
    const tpr3 = parseIntStrict(fd.get('tpr3'));
    const tpr4 = parseIntStrict(fd.get('tpr4'));

    if (dCm === null || wCm === null || hCm === null) throw new Error('Заполните Длина/Ширина/Высота (только цифры).');
    if (weightKg === null) throw new Error('Вес должен быть числом, можно с точкой (например 1.5).');
    if (sgDays === null) throw new Error('СГ (дней) должен быть числом.');
    if (tpr3 === null || tpr4 === null) throw new Error('ТПР3 и ТПР4 обязательны и должны быть числами.');

    const sgPercent = parseNumber(fd.get('sg_percent'));

    const payload = {
      requestId,
      clientTs: new Date().toISOString(),
      supplier: String(fd.get('supplier') || '').trim(),
      productType: String(fd.get('product_type') || '').trim(),
      lk: String(fd.get('lk') || '').trim(),
      d_m: dCm / 100,
      w_m: wCm / 100,
      h_m: hCm / 100,
      weightKg,
      tpr1: 1,
      tpr2: tpr2 ?? null,
      tpr3,
      tpr4,
      sgDays,
      sgPercent: sgPercent ?? null,
      mfgDate: String(fd.get('mfg_date') || ''),
      expiryDate: expiryDateOutEl ? String(expiryDateOutEl.value || '') : '',
      problem: getSelectedProblem(),
      barcodeNotScanningReason: String(fd.get('barcode_not_scanning_reason') || ''),
      comment: String(fd.get('comment') || ''),
      files: []
    };

    const fileFields = [
      { name: 'photo_barcode_box', required: true },
      { name: 'photo_barcode_item', required: true },
      { name: 'photo_box_overall', required: true },
      { name: 'photo_barcode_block', required: Boolean(tpr2 && tpr2 > 0) },
      { name: 'box_attachments', required: true, multiple: true }
    ];

    for (const ff of fileFields) {
      if (ff.multiple) {
        const list = Array.from((fd.getAll(ff.name) || [])).filter((x) => x instanceof File);
        if (ff.required && list.length === 0) throw new Error('Добавьте обязательные вложения коробки.');
        for (const f of list) {
          payload.files.push({
            field: ff.name,
            name: f.name,
            mimeType: f.type || 'application/octet-stream',
            size: f.size,
            dataBase64: await fileToBase64(f)
          });
        }
      } else {
        const f = fd.get(ff.name);
        if (f instanceof File && f.size > 0) {
          payload.files.push({
            field: ff.name,
            name: f.name,
            mimeType: f.type || 'application/octet-stream',
            size: f.size,
            dataBase64: await fileToBase64(f)
          });
        } else if (ff.required) {
          throw new Error('Добавьте все обязательные фото.');
        }
      }
    }

    if (!navigator.onLine) {
      await queueAdd_(payload);
      toast_('Нет интернета. Заявка добавлена в очередь.', { type: 'warning', timeoutMs: 4200 });

      // prevent multiple manual submits of the same data
      formEl.reset();
      resetRequestId_();
      filesHintEl.textContent = '';
      syncBlockPhotoVisibility();
      syncProblemDetails();
      await renderQueue_();
      return;
    }

    try {
      await sendPayload_(payload);
    } catch (err) {
      if (isNetworkError_(err)) {
        await queueAdd_(payload);
        toast_('Проблема с сетью. Заявка добавлена в очередь.', { type: 'warning', timeoutMs: 4200 });

        formEl.reset();
        resetRequestId_();
        filesHintEl.textContent = '';
        syncBlockPhotoVisibility();
        syncProblemDetails();
        await renderQueue_();
        return;
      }
      throw err;
    }

    formEl.reset();
    resetRequestId_();
    filesHintEl.textContent = '';
    syncBlockPhotoVisibility();
    syncProblemDetails();
    await renderQueue_();
    toast_('Отправлено.', { type: 'success' });
    openSuccessModal_();
  } catch (err) {
    const msg = err instanceof Error
      ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
      : String(err);
    console.error('SUBMIT_ERROR', err);
    toast_(msg, { type: 'error', timeoutMs: 6000 });
  } finally {
    submitBtn.disabled = false;
    document.body.classList.remove('submitting');
  }
});
