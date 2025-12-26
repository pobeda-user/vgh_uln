var CONFIG = {
  SPREADSHEET_ID: '1fKgpHZV4MxWm8PP3H7ZXtaJ51kaNlKyGldy52ttijLQ',
  SHEET_MAIN: 'Лист1',
  SHEET_LOGS: 'Логи',
  SHEET_FUNC_LOGS: 'Логи Функции',
  SHEET_BROADCAST: 'Рассылка',
  DRIVE_FOLDER_ID: '1srJXtU7mIJTK9R8CNdnjTsfoF5iwOteQ',
  BOT_USERNAME: 'uln_vgh_bot',

  // Properties keys
  PROP_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  PROP_ADMIN_CHAT_ID: 'ADMIN_CHAT_ID',
  PROP_GROUP_CHAT_ID: 'GROUP_CHAT_ID'
};

// Кэш для отслеживания обработанных сообщений
var messageCache = {};

function doPost(e) {
  // ... (unchanged)
}

function handleCallbackQuery_(callback) {
  var logSh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_LOGS);
  if (logSh) {
    logSh.appendRow([new Date(), 'callbackQuery', 'RECEIVED', callback.from ? callback.from.id : '', 'Data: ' + (callback.data || 'none'), '']);
  }

  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  var adminChatId = props.getProperty(CONFIG.PROP_ADMIN_CHAT_ID);
  var groupChatId = props.getProperty(CONFIG.PROP_GROUP_CHAT_ID);

  // Always answer callback query quickly
  if (callback && callback.id && botToken) {
    var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/answerCallbackQuery';
    UrlFetchApp.fetch(api, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ callback_query_id: callback.id })
    });
  }

  if (!botToken || !adminChatId || !groupChatId) return;

  // Only admin is allowed to change status
  var fromId = callback && callback.from && callback.from.id != null ? String(callback.from.id) : '';
  if (fromId !== String(adminChatId)) return;

  var data = String(callback && callback.data ? callback.data : '');
  var m = data.match(/^(done|rework):(\d+)$/);
  if (!m) return;
  var action = m[1];
  var rowNum = parseInt(m[2], 10);
  if (!rowNum || rowNum < 2) return;

  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
  if (!sh) return;
  ensureHeaderMain_(sh);

  // Columns (fixed by ensureHeaderMain_)
  var COL_STATUS = 21;
  var COL_GROUP_MSG_ID = 22;
  var COL_ADMIN_MSG_ID = 23;
  var COL_REQUEST_ID = 1;

  var groupMsgId = sh.getRange(rowNum, COL_GROUP_MSG_ID).getValue();
  var newStatus = action === 'done' ? 'DONE' : 'REWORK';
  sh.getRange(rowNum, COL_STATUS).setValue(newStatus);

  var groupText = action === 'done'
    ? '✅ <b>ВГХ внесены</b>, прошу проверить.'
    : '↩️ <b>Статус возвращен</b>, будут внесены правки. Ожидайте изменения.';

  // Reply in group to original submission message if possible
  var replyTo = groupMsgId ? Number(groupMsgId) : null;
  sendTelegramMessage_(botToken, groupChatId, groupText, {
    replyToMessageId: replyTo,
    disableWebPagePreview: true
  });

  // Optional: update admin message buttons (keep them, but show current status)
  if (callback && callback.message && callback.message.chat && callback.message.chat.id != null && callback.message.message_id != null) {
    var adminMsgId = Number(callback.message.message_id);
    var adminText = 'Статус: ' + (newStatus === 'DONE' ? '✅ Готово' : '↩️ На доработку');
    editTelegramMessage_(botToken, callback.message.chat.id, adminMsgId, adminText);
    sh.getRange(rowNum, COL_ADMIN_MSG_ID).setValue(adminMsgId);
  }
}

function handleSiteSubmit_(data) {
  var cfg = getConfig_();
  ensureSheets_();
  
  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  var sh = ss.getSheetByName(cfg.SHEET_MAIN);
  if (!sh) throw new Error('Sheet not found: ' + cfg.SHEET_MAIN);

  ensureHeaderMain_(sh);
  
  var files = Array.isArray(data.files) ? data.files : [];
  var uploaded = [];
  if (files.length) {
    var rootFolder = DriveApp.getFolderById(cfg.DRIVE_FOLDER_ID);
    var now = new Date();
    var dateFolderName = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var supplierName = safeFolderName_(String(data && data.supplier ? data.supplier : '').trim()) || 'без поставщика';
    var driveFolder = getOrCreateSubfolder_(getOrCreateSubfolder_(rootFolder, dateFolderName), supplierName);
    for (var i = 0; i < files.length; i++) {
      var f = files[i] || {};
      var bytes = Utilities.base64Decode(String(f.dataBase64 || ''));
      var blob = Utilities.newBlob(bytes, String(f.mimeType || 'application/octet-stream'), String(f.name || ('file_' + (i + 1))));
      var file = driveFolder.createFile(blob);
      uploaded.push({ field: String(f.field || ''), url: file.getUrl(), name: file.getName() });
    }
  }
  
  // Server-side dedupe by requestId to avoid duplicate rows/messages
  var requestId = String(data && data.requestId ? data.requestId : '').trim();
  if (requestId) {
    try {
      var cache = CacheService.getScriptCache();
      var key = 'site_req_' + requestId;
      if (cache.get(key)) {
        return json_({ ok: true, deduped: true });
      }
      cache.put(key, '1', 21600); // 6 hours
    } catch (_) {}
  }
  
  var row = buildMainRow_(data, uploaded);
  sh.appendRow(row);
  var rowNum = sh.getLastRow();
  
  logEvent_('site', 'submit', {
    supplier: data && data.supplier,
    problem: data && data.problem,
    filesCount: files.length
  }, { payload: data });

  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(cfg.PROP_BOT_TOKEN);
  var adminChatId = props.getProperty(cfg.PROP_ADMIN_CHAT_ID);
  var groupChatId = props.getProperty(cfg.PROP_GROUP_CHAT_ID);

  if (botToken && adminChatId && groupChatId) {
    var message = buildTelegramMessageFromSite_(data);

    // 1) Send to group
    var groupMsgId = sendTelegramMessage_(botToken, groupChatId, message, { disableWebPagePreview: true });

    // 2) Send to admin with inline buttons
    var adminMsgId = sendTelegramMessage_(botToken, adminChatId, message, {
      disableWebPagePreview: true,
      replyMarkup: {
        inline_keyboard: [[
          { text: '✅ Готово', callback_data: 'done:' + String(rowNum) },
          { text: '↩️ Вернуть на доработку', callback_data: 'rework:' + String(rowNum) }
        ]]
      }
    });

    // Save status and message ids
    var COL_STATUS = 21;
    var COL_GROUP_MSG_ID = 22;
    var COL_ADMIN_MSG_ID = 23;
    sh.getRange(rowNum, COL_STATUS).setValue('NEW');
    if (groupMsgId) sh.getRange(rowNum, COL_GROUP_MSG_ID).setValue(groupMsgId);
    if (adminMsgId) sh.getRange(rowNum, COL_ADMIN_MSG_ID).setValue(adminMsgId);
  } else {
    logFunctionWarn_('handleSiteSubmit_', 'Telegram token or ADMIN_CHAT_ID not set in Script Properties', {
      hasToken: Boolean(botToken),
      hasAdminChatId: Boolean(adminChatId),
      hasGroupChatId: Boolean(groupChatId)
    });
  }

  return json_({ ok: true });
}

function buildMainRow_(data, uploaded) {
  var ts = new Date();
  var details = resolveProblemDetails_(data);

  return [
    ts,
    String(data.requestId || ''),
    String(data.supplier || ''),
    String(data.productType || ''),
    String(data.lk || ''),
    Number(data.d_m || 0),
    Number(data.w_m || 0),
    Number(data.h_m || 0),
    data.tpr2 == null ? '' : Number(data.tpr2),
    Number(data.tpr3 || 0),
    Number(data.tpr4 || 0),
    Number(data.sgDays || 0),
    data.sgPercent == null ? '' : Number(data.sgPercent),
    String(data.mfgDate || ''),
    String(data.expiryDate || ''),
    Number(data.weightKg || 0),
    String(data.problem || ''),
    details,
    String(data.comment || ''),
    JSON.stringify(uploaded),
    '',
    '',
    ''
  ];
}

function ensureHeaderMain_(sh6) {
  var header = [
    'Дата/время',
    'requestId',
    'Поставщик',
    'Тип товара',
    'ЛК товара',
    'Д (м)',
    'Ш (м)',
    'В (м)',
    'ТПР2 блок (шт)',
    'ТПР3 коробка (шт)',
    'ТПР4 паллет (уп)',
    'СГ (дней)',
    'СГ (%)',
    'Дата изготовления',
    'Годен до',
    'Вес (кг)',
    'Проблема',
    'Детали проблемы',
    'Комментарий',
    'Файлы',
    'Статус',
    'TG msg_id (группа)',
    'TG msg_id (админ)'
  ];

  if (sh6.getLastRow() === 0) {
    sh6.appendRow(header);
    return;
  }

  var existing = sh6.getRange(1, 1, 1, header.length).getValues()[0];
  var ok = true;
  for (var i = 0; i < header.length; i++) {
    if (String(existing[i] || '').trim() !== header[i]) {
      ok = false;
      break;
    }
  }
  if (!ok) {
    sh6.insertRowBefore(1);
    sh6.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function resolveProblemDetails_(data) {
  var p = String(data && data.problem ? data.problem : '');
  if (p === 'barcode_not_scanning') {
    var r = String(data && data.barcodeNotScanningReason ? data.barcodeNotScanningReason : '');
    if (r === 'physical') return 'Не читается ШК физически';
    if (r === 'wrong_product') return 'Пишет не верный товар';
    return 'ШК не сканируется';
  }
  if (p === 'barcode_wrong_item') return 'Пишет не верный товар';
  if (p === 'need_handlecode') return 'Нужен хендлкод';
  if (p === 'stuck_on_gm') return 'Зависло на ГМ';
  return '';
}

function productTypeLabel_(code) {
  var c = String(code || '').trim();
  if (c === 'dry') return 'Сухой';
  if (c === 'fresh') return 'ФРЕШ';
  if (c === 'frov') return 'ФРОВ';
  if (c === 'frozen') return 'Заморозка';
  if (c === 'strong_alcohol') return 'Крепкий алкоголь';
  return c;
}

function buildTelegramMessageFromSite_(data) {
  var lines = [];
  var supplier = String(data && data.supplier ? data.supplier : '').trim();
  var productType = productTypeLabel_(data && data.productType ? data.productType : '');
  var lk = String(data && data.lk ? data.lk : '').trim();
  var d = data && data.d_m != null ? Number(data.d_m) : null;
  var w = data && data.w_m != null ? Number(data.w_m) : null;
  var h = data && data.h_m != null ? Number(data.h_m) : null;
  var weightKg = data && data.weightKg != null ? Number(data.weightKg) : null;
  var tpr2 = data && data.tpr2 != null ? Number(data.tpr2) : null;
  var tpr3 = data && data.tpr3 != null ? Number(data.tpr3) : null;
  var tpr4 = data && data.tpr4 != null ? Number(data.tpr4) : null;
  var sgDays = data && data.sgDays != null ? Number(data.sgDays) : null;
  var sgPercent = data && data.sgPercent != null && String(data.sgPercent) !== '' ? Number(data.sgPercent) : null;
  var mfgDate = String(data && data.mfgDate ? data.mfgDate : '').trim();
  var expiryDate = String(data && data.expiryDate ? data.expiryDate : '').trim();

  lines.push('📝 Новая заявка');
  if (supplier) lines.push('🏭 Поставщик: ' + supplier);
  if (productType) lines.push('🏷️ Тип товара: ' + productType);
  if (lk) lines.push('🧾 ЛК: ' + lk);
  if (d != null && w != null && h != null && !isNaN(d) && !isNaN(w) && !isNaN(h)) {
    lines.push('📏 Габариты (м):');
    lines.push('Длина-Ширина-Высота');
    lines.push('<b>' + d + '</b>');
    lines.push('<b>' + w + '</b>');
    lines.push('<b>' + h + '</b>');
  }
  if (weightKg != null && !isNaN(weightKg)) lines.push('⚖️ Вес: ' + weightKg + ' кг');
  if (tpr2 != null && !isNaN(tpr2) && tpr2 > 0) lines.push('🧊 ТПР2 (блок): ' + tpr2);
  if (tpr3 != null && !isNaN(tpr3)) lines.push('📦 ТПР3 (коробка): ' + tpr3);
  if (tpr4 != null && !isNaN(tpr4)) {
    if (tpr3 != null && !isNaN(tpr3)) {
      lines.push('🪵 ТПР4 (паллет): ' + tpr4 + '  →  📦 <b>ИТОГО УПАКОВОК: ' + (tpr3 * tpr4) + '</b>');
    } else {
      lines.push('🪵 ТПР4 (паллет): ' + tpr4);
    }
  }
  if (sgDays != null && !isNaN(sgDays)) lines.push('⏳ СГ (дней): ' + sgDays);
  if (sgPercent != null && !isNaN(sgPercent)) lines.push('📈 Процент СГ: ' + sgPercent);
  if (mfgDate) lines.push('🏷️ Дата изготовления: ' + mfgDate);
  if (expiryDate) lines.push('📅 Годен до: ' + expiryDate);
  var prob = resolveProblemDetails_(data);
  if (prob) {
    lines.push('⚠️ Проблема: <b>' + prob + '</b>');
  }
  var comment = String(data && data.comment ? data.comment : '').trim();
  if (comment) lines.push('💬 Комментарий: ' + comment);
  return lines.join('\n');
}

function sendTelegram_(botToken, chatId, text) {
  var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/sendMessage';
  UrlFetchApp.fetch(api, {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      chat_id: String(chatId),
      text: String(text || ''),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }
  });
}

function safeLogEvent_(source, action, summaryObj, payloadObj) {
  try {
    ensureSheets_();
    logEvent_(source, action, summaryObj || {}, payloadObj || null);
  } catch (_) {}
}

function safeSaveUserChatId_(chatId) {
  try {
    ensureSheets_();
    var ss7 = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh7 = ss7.getSheetByName(CONFIG.SHEET_BROADCAST);
    if (!sh7) return;

    var lastRow = sh7.getLastRow();
    if (lastRow < 2) {
      sh7.appendRow([String(chatId), 1, '', '', '']);
      return;
    }

    var vals = sh7.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(chatId)) return;
    }
    sh7.appendRow([String(chatId), 1, '', '', '']);
  } catch (_) {}
}

function buildWelcomeMessage_() {
  return 'Привет! Заполняй форму PWA — я отправлю данные администратору.\n\nФорма: https://pobeda-user.github.io/vgh_uln/\n\n/help — помощь';
}

function buildHelpMessage_() {
  return 'Команды:\n/start — приветствие\n/help — помощь\n\nФорма: https://pobeda-user.github.io/vgh_uln/';
}

function isDuplicateTelegramUpdate_(updateId) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'tg_update_' + String(updateId);
    var cached = cache.get(key);
    
    if (cached) {
      // Увеличиваем счетчик повторений для отладки
      var count = parseInt(cached) || 1;
      cache.put(key, String(count + 1), 21600); // 6 часов
      
      // Логируем только если много повторений
      if (count > 1) {
        Logger.log('Update ' + updateId + ' repeated ' + count + ' times');
      }
      return true;
    }
    
    cache.put(key, '1', 21600);
    return false;
  } catch (_) {
    return false;
  }
}

function isDuplicateStart_(chatId) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'tg_start_' + String(chatId);
    if (cache.get(key)) return true;
    cache.put(key, '1', 43200);
    return false;
  } catch (_) {
    return false;
  }
}

// Дополнительные служебные функции
function testBot() {
  var props3 = PropertiesService.getScriptProperties();
  var botToken = props3.getProperty(CONFIG.PROP_BOT_TOKEN);
  var adminChatId = props3.getProperty(CONFIG.PROP_ADMIN_CHAT_ID);

  if (!botToken || !adminChatId) {
    Logger.log('❌ Токен или chat_id не настроены');
    return;
  }

  sendTelegram_(botToken, adminChatId, '🤖 Бот работает! Тестовое сообщение.');
  Logger.log('✅ Тестовое сообщение отправлено');
}

function checkCurrentWebhook() {
  var props4 = PropertiesService.getScriptProperties();
  var botToken = props4.getProperty(CONFIG.PROP_BOT_TOKEN);

  if (!botToken) {
    Logger.log('❌ Токен не найден');
    return;
  }

  var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/getWebhookInfo';
  var response = UrlFetchApp.fetch(api);
  var result = JSON.parse(response.getContentText());

  Logger.log('Вебхук настроен на: ' + (result.result.url || 'не установлен'));
  Logger.log('Ожидающих обновлений: ' + result.result.pending_update_count);
  if (result.result.last_error_message) {
    Logger.log('Последняя ошибка: ' + result.result.last_error_message);
  }

  return result;
}

/**
 * Сбрасывает очередь Telegram и переустанавливает webhook.
 * Запусти эту функцию вручную в Apps Script если бот "завис" на старых сообщениях.
 */
function resetWebhook() {
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);

  if (!botToken) {
    Logger.log('❌ Токен не найден');
    return;
  }

  var webAppUrl = String(props.getProperty('WEB_APP_URL') || '').trim();
  if (!webAppUrl) {
    webAppUrl = String(ScriptApp.getService().getUrl() || '').trim();
  }
  if (webAppUrl && /\/dev\s*$/i.test(webAppUrl)) {
    webAppUrl = webAppUrl.replace(/\/dev\s*$/i, '/exec');
  }
  Logger.log('Web App URL (for webhook): ' + webAppUrl);

  if (!webAppUrl) {
    Logger.log('❌ Не удалось определить URL веб-приложения. Укажи Script Property WEB_APP_URL = .../exec');
    return;
  }

  // 1. Удаляем webhook и сбрасываем очередь
  var deleteApi = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/deleteWebhook';
  var deleteRes = UrlFetchApp.fetch(deleteApi, {
    method: 'post',
    payload: { drop_pending_updates: true }
  });
  Logger.log('deleteWebhook: ' + deleteRes.getContentText());

  // 2. Устанавливаем webhook заново
  var setApi = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/setWebhook';
  var setRes = UrlFetchApp.fetch(setApi, {
    method: 'post',
    payload: { url: webAppUrl }
  });
  Logger.log('setWebhook: ' + setRes.getContentText());

  // 3. Проверяем результат
  var infoApi = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/getWebhookInfo';
  var infoRes = UrlFetchApp.fetch(infoApi);
  var info = JSON.parse(infoRes.getContentText());
  Logger.log('Новый вебхук: ' + (info.result.url || 'не установлен'));
  Logger.log('Ожидающих обновлений: ' + info.result.pending_update_count);

  return info;
}