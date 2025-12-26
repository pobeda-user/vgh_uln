const statusEl = document.getElementById('status');
const formEl = document.getElementById('requestForm');
const filesHintEl = document.getElementById('filesHint');
const submitBtn = document.getElementById('submitBtn');
const installBtn = document.getElementById('installBtn');
const offlineBadge = document.getElementById('offlineBadge');
const chooseProblemBtn = document.getElementById('chooseProblemBtn');
const problemGridEl = document.getElementById('problemGrid');
const photoBarcodeBlockEl = document.getElementById('photoBarcodeBlock');
const photoBarcodeBlockWrapEl = document.getElementById('photoBarcodeBlockWrap');
const attachmentsEl = document.getElementById('boxAttachments');
const barcodeNotScanningDetailsEl = document.getElementById('barcodeNotScanningDetails');
const calcSgBtn = document.getElementById('calcSgBtn');
const sgPercentEl = document.getElementById('sgPercent');
const expiryDateOutEl = document.getElementById('expiryDateOut');

const CONFIG = {
  // For GitHub Pages (static hosting), submit directly to Google Apps Script Web App.
  // Use Content-Type: text/plain to avoid CORS preflight.
  submitUrl: 'https://script.google.com/macros/s/AKfycbwR70njJu1aRLypsx1T3FtRHPvRw68da6Hw2U2ZwYxMsRKkuRPCIIJyyeTNAHFUhYgt1A/exec'
};

function setStatus(text, { error = false } = {}) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

function updateOffline() {
  const offline = !navigator.onLine;
  offlineBadge.hidden = !offline;
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
    el.value = sanitizeDigitsOnly(el.value);
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
    setStatus('Для расчёта СГ% укажите дату изготовления и срок годности (дней).', { error: true });
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
  setStatus('СГ% рассчитан.');
});

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

window.addEventListener('online', updateOffline);
window.addEventListener('offline', updateOffline);
updateOffline();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (_) {
    }
  });
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('Отправка...');
  submitBtn.disabled = true;

  try {
    if (!CONFIG.submitUrl) {
      throw new Error('Не задан URL отправки.');
    }

    const fd = new FormData(formEl);

    const dCm = parseNumber(fd.get('d_cm'));
    const wCm = parseNumber(fd.get('w_cm'));
    const hCm = parseNumber(fd.get('h_cm'));
    const weightKg = parseNumber(fd.get('weight_kg'));
    const sgDays = parseIntStrict(fd.get('sg_days'));
    const tpr2 = getTpr2Value_();
    const tpr3 = parseIntStrict(fd.get('tpr3'));
    const tpr4 = parseIntStrict(fd.get('tpr4'));

    if (dCm === null || wCm === null || hCm === null) throw new Error('Д/Ш/В должны быть числами.');
    if (weightKg === null) throw new Error('Вес должен быть числом.');
    if (sgDays === null) throw new Error('СГ (дней) должен быть числом.');
    if (tpr3 === null || tpr4 === null) throw new Error('ТПР3 и ТПР4 обязательны и должны быть числами.');

    const sgPercent = parseNumber(fd.get('sg_percent'));

    const payload = {
      clientTs: new Date().toISOString(),
      supplier: String(fd.get('supplier') || '').trim(),
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

    const res = await fetch(CONFIG.submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8'
      },
      body: JSON.stringify(payload)
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

    if (!data || data.ok !== true) {
      throw new Error(`Ответ сервера не JSON/ok=true\n${responseText}`.trim());
    }

    formEl.reset();
    filesHintEl.textContent = '';
    syncBlockPhotoVisibility();
    syncProblemDetails();
    setStatus('Отправлено.');
  } catch (err) {
    const msg = err instanceof Error
      ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
      : String(err);
    console.error('SUBMIT_ERROR', err);
    setStatus(msg, { error: true });
  } finally {
    submitBtn.disabled = false;
  }
});
