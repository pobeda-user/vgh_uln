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
  PROP_ADMIN_CHAT_ID: 'ADMIN_CHAT_ID'
};

// Кэш для отслеживания обработанных сообщений
var messageCache = {};

function doPost(e) {
  var logSh;
  var timestamp = new Date();
  var isSiteRequest = false;
  var isSiteHint = false;
  
  try {
    // Сразу открываем лист для логирования
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    logSh = ss.getSheetByName(CONFIG.SHEET_LOGS);
    
    // Базовое логирование входящего запроса
    var postData = e.postData ? e.postData.contents : '';
    isSiteHint = postData && postData.indexOf('"clientTs"') !== -1;
    if (!postData) {
      if (logSh) {
        logSh.appendRow([timestamp, 'doPost', 'EMPTY_REQUEST', '', '', '']);
      }
      return ContentService.createTextOutput('ok');
    }
    
    var truncatedData = postData.length > 300 ? postData.substring(0, 300) + '...' : postData;
    if (logSh) {
      logSh.appendRow([timestamp, 'doPost', 'INCOMING_REQUEST', '', 
        'Length: ' + postData.length + ' chars', truncatedData]);
    }
    
    // Парсим данные
    var update = JSON.parse(postData);
    isSiteRequest = Boolean(update && update.clientTs);

    if (isSiteRequest) {
      return handlePwaSubmit_(update, logSh);
    }

    return handleTelegramUpdate_(update, logSh, timestamp);
    
  } catch (error) {
    // Обязательно логируем ошибки
    if (logSh) {
      logSh.appendRow([new Date(), 'doPost', 'ERROR', '', 
        error.toString(), error.stack || '']);
    } else {
      Logger.log('doPost ERROR (no sheet): ' + error.toString());
    }

    if (isSiteRequest || isSiteHint) {
      return json_({ ok: false, error: String(error && error.message ? error.message : error) });
    }
  }
  
  // Фолбэк: всегда возвращаем ответ, даже при ошибках
  if (isSiteRequest || isSiteHint) {
    return json_({ ok: false, error: 'UNKNOWN_ERROR' });
  }
  return ContentService.createTextOutput('ok');
}

function handlePwaSubmit_(update, logSh) {
  if (logSh) {
    try {
      logSh.appendRow([new Date(), 'doPost', 'SITE_SUBMIT', '', 'clientTs: ' + update.clientTs, '']);
    } catch (_) {}
  }
  return handleSiteSubmit_(update);
}

function handleTelegramUpdate_(update, logSh, timestamp) {
  if (update && update.update_id != null) {
    if (isDuplicateTelegramUpdate_(update.update_id)) {
      if (logSh) {
        try {
          logSh.appendRow([new Date(), 'doPost', 'DUPLICATE_UPDATE_SKIPPED', '', 'update_id: ' + update.update_id, '']);
        } catch (_) {}
      }
      return ContentService.createTextOutput('ok');
    }
  }

  // ===== SERVICE UPDATE (например my_chat_member) =====
  if (update && (update.my_chat_member || update.chat_member || update.edited_message || update.channel_post || update.edited_channel_post || update.inline_query || update.chosen_inline_result || update.shipping_query || update.pre_checkout_query)) {
    var svcChatId = '';
    try {
      var chatObj = null;
      if (update.my_chat_member && update.my_chat_member.chat) chatObj = update.my_chat_member.chat;
      else if (update.chat_member && update.chat_member.chat) chatObj = update.chat_member.chat;
      else if (update.edited_message && update.edited_message.chat) chatObj = update.edited_message.chat;
      else if (update.channel_post && update.channel_post.chat) chatObj = update.channel_post.chat;
      else if (update.edited_channel_post && update.edited_channel_post.chat) chatObj = update.edited_channel_post.chat;
      if (chatObj && chatObj.id != null) svcChatId = String(chatObj.id);
    } catch (_) {}

    if (svcChatId) safeSaveUserChatId_(svcChatId);

    if (logSh) {
      try {
        var keys = Object.keys(update || {});
        logSh.appendRow([new Date(), 'doPost', 'TELEGRAM_SERVICE_UPDATE', svcChatId, 'Keys: ' + safeJsonStringify_(keys), '']);
      } catch (_) {}
    }

    return ContentService.createTextOutput('ok');
  }

  // ===== MESSAGE =====
  if (update && update.message) {
    var message = update.message;
    var chatId = message.chat ? message.chat.id : 'no_chat';
    var messageId = message.message_id;
    var text = String(message.text || '').trim();

    var messageKey = String(chatId) + '_' + String(messageId);
    if (messageCache[messageKey]) {
      if (logSh) {
        try {
          logSh.appendRow([new Date(), 'doPost', 'DUPLICATE_SKIPPED', chatId, 'Already processed: ' + messageId, '']);
        } catch (_) {}
      }
      return ContentService.createTextOutput('ok');
    }

    messageCache[messageKey] = timestamp || new Date();
    cleanMessageCache_();

    if (logSh) {
      try {
        logSh.appendRow([new Date(), 'doPost', 'TELEGRAM_MSG', chatId, 'Text: "' + text + '"', 'MsgID: ' + messageId]);
      } catch (_) {}
    }

    handleMessage_(message);
    return ContentService.createTextOutput('ok');
  }

  // ===== CALLBACK QUERY =====
  if (update && update.callback_query) {
    var callback = update.callback_query;
    if (logSh) {
      try {
        logSh.appendRow([new Date(), 'callbackQuery', 'RECEIVED', callback.from ? callback.from.id : '', 'Data: ' + (callback.data || 'none'), '']);
      } catch (_) {}
    }
    handleCallbackQuery_(callback);
    return ContentService.createTextOutput('ok');
  }

  // ===== UNKNOWN FORMAT =====
  if (logSh) {
    try {
      logSh.appendRow([new Date(), 'doPost', 'UNKNOWN_FORMAT', '', 'Keys: ' + safeJsonStringify_(Object.keys(update || {})), safeJsonStringify_(update || {}).substring(0, 200)]);
    } catch (_) {}
  }

  return ContentService.createTextOutput('ok');
}

function cleanMessageCache_() {
  var now = new Date().getTime();
  var fiveMinutes = 5 * 60 * 1000;
  
  for (var key in messageCache) {
    if (now - messageCache[key].getTime() > fiveMinutes) {
      delete messageCache[key];
    }
  }
}

function handleMessage_(message) {
  var chat = message.chat || {};
  var chatId = chat.id;
  var chatType = chat.type;
  var text = String(message.text || '').trim();
  
  // Только приватные чаты
  if (chatType !== 'private') return;
  
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  if (!botToken) return;
  
  // Обработка команд - минимум логов для скорости
  try {
    if (text.indexOf('/start') === 0) {
      if (isDuplicateStart_(chatId)) return;
      sendTelegram_(botToken, chatId, buildWelcomeMessage_());
    } else if (text.indexOf('/help') === 0) {
      sendTelegram_(botToken, chatId, buildHelpMessage_());
    } else if (text.indexOf('@' + CONFIG.BOT_USERNAME) !== -1) {
      sendTelegram_(botToken, chatId, 'Я бот для приёма ВГХ/проблем. Заполняй форму на сайте — я отправлю данные администратору.');
    } else {
      // Не команда - сохраняем chat_id для рассылок
      safeSaveUserChatId_(chatId);
    }
  } catch (error) {
    // Логируем только ошибки
    try {
      var logSh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_LOGS);
      if (logSh) {
        logSh.appendRow([new Date(), 'handleMessage', 'ERROR', chatId, error.toString(), text]);
      }
    } catch (_) {}
  }
}

function handleCallbackQuery_(callback) {
  // Заглушка для обработки inline-кнопок
  var logSh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_LOGS);
  if (logSh) {
    logSh.appendRow([new Date(), 'callbackQuery', 'RECEIVED', 
      callback.from ? callback.from.id : '', 
      'Data: ' + (callback.data || 'none'), '']);
  }
  
  // TODO: реализовать логику обработки callback-запросов
  // Пока просто отвечаем пустым ответом
  if (callback.id) {
    var props = PropertiesService.getScriptProperties();
    var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
    if (botToken) {
      var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/answerCallbackQuery';
      UrlFetchApp.fetch(api, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          callback_query_id: callback.id
        })
      });
    }
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
  
  var row = buildMainRow_(data, uploaded);
  sh.appendRow(row);
  
  logEvent_('site', 'submit', {
    supplier: data && data.supplier,
    problem: data && data.problem,
    filesCount: files.length
  }, { payload: data });

  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(cfg.PROP_BOT_TOKEN);
  var adminChatId = props.getProperty(cfg.PROP_ADMIN_CHAT_ID);

  if (botToken && adminChatId) {
    var message = buildTelegramMessageFromSite_(data);
    sendTelegram_(botToken, adminChatId, message);
  } else {
    logFunctionWarn_('handleSiteSubmit_', 'Telegram token or ADMIN_CHAT_ID not set in Script Properties', {
      hasToken: Boolean(botToken),
      hasAdminChatId: Boolean(adminChatId)
    });
  }

  return json_({ ok: true });
}

function logToSheet_(chatId, text) {
  try {
    var ss2 = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh2 = ss2.getSheetByName(CONFIG.SHEET_LOGS);
    if (sh2) {
      sh2.appendRow([new Date(), 'telegram_command', text, String(chatId), '', '']);
    }
  } catch (e) {
  }
}

function buildMainRow_(data, uploaded) {
  var ts = new Date();
  var details = resolveProblemDetails_(data);

  return [
    ts,
    String(data.supplier || ''),
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
    JSON.stringify(uploaded)
  ];
}

function ensureSheet_(ss3, sheetName, header) {
  var sh3 = ss3.getSheetByName(sheetName);
  if (!sh3) sh3 = ss3.insertSheet(sheetName);

  if (sh3.getLastRow() === 0) {
    sh3.appendRow(header);
    if (sheetName === CONFIG.SHEET_BROADCAST) {
      sh3.appendRow(['', '', '', '', '']);
    }
    return;
  }

  var existing = sh3.getRange(1, 1, 1, header.length).getValues()[0];
  var ok = true;
  for (var i = 0; i < header.length; i++) {
    if (String(existing[i] || '').trim() !== header[i]) {
      ok = false;
      break;
    }
  }
  if (!ok) {
    sh3.insertRowBefore(1);
    sh3.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function logEvent_(source, action, summaryObj, payloadObj) {
  var cfg2 = getConfig_();
  var ss4 = SpreadsheetApp.openById(cfg2.SPREADSHEET_ID);
  var sh4 = ss4.getSheetByName(cfg2.SHEET_LOGS);
  if (!sh4) return;

  var chatId = '';
  if (summaryObj && summaryObj.chatId) chatId = String(summaryObj.chatId);

  sh4.appendRow([
    new Date(),
    String(source || ''),
    String(action || ''),
    chatId,
    safeJsonStringify_(summaryObj || {}),
    payloadObj ? safeJsonStringify_(payloadObj) : ''
  ]);
}

function logFunctionInfo_(funcName, message, ctx) {
  logFunction_('INFO', funcName, message, null, ctx);
}

function logFunctionWarn_(funcName, message, ctx) {
  logFunction_('WARN', funcName, message, null, ctx);
}

function logFunctionError_(funcName, err, ctx) {
  logFunction_('ERROR', funcName, '', err, ctx);
}

function logFunction_(level, funcName, message, err, ctx) {
  try {
    var cfg3 = getConfig_();
    var ss5 = SpreadsheetApp.openById(cfg3.SPREADSHEET_ID);
    var sh5 = ss5.getSheetByName(cfg3.SHEET_FUNC_LOGS);
    if (!sh5) return;

    var errorText = err ? (err && err.message ? err.message : String(err)) : '';
    var stack = '';
    try {
      if (err && err.stack) stack = String(err.stack);
    } catch (_) {}

    sh5.appendRow([
      new Date(),
      String(level || ''),
      String(funcName || ''),
      String(message || ''),
      errorText,
      stack,
      safeJsonStringify_(ctx || {})
    ]);
  } catch (_) {}
}

function getConfig_() {
  var props2 = PropertiesService.getScriptProperties();
  var out = {};
  for (var k in CONFIG) out[k] = CONFIG[k];

  var spreadsheetId = props2.getProperty('SPREADSHEET_ID');
  if (spreadsheetId) out.SPREADSHEET_ID = spreadsheetId;

  var folderId = props2.getProperty('DRIVE_FOLDER_ID');
  if (folderId) out.DRIVE_FOLDER_ID = folderId;

  var botUsername = props2.getProperty('BOT_USERNAME');
  if (botUsername) out.BOT_USERNAME = botUsername;

  var sheetMain = props2.getProperty('SHEET_MAIN');
  if (sheetMain) out.SHEET_MAIN = sheetMain;

  return out;
}

function safeJsonStringify_(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return String(obj);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureSheets_() {
  var ss6 = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  ensureSheet_(ss6, CONFIG.SHEET_LOGS, ['ts', 'source', 'action', 'chatId', 'summary', 'payload']);
  ensureSheet_(ss6, CONFIG.SHEET_FUNC_LOGS, ['ts', 'level', 'func', 'message', 'error', 'stack', 'ctx']);
  ensureSheet_(ss6, CONFIG.SHEET_BROADCAST, ['chat_id', 'active', 'last_sent', 'name', 'notes']);
}

function ensureHeaderMain_(sh6) {
  var header = [
    'ts',
    'supplier',
    'lk',
    'd_m',
    'w_m',
    'h_m',
    'tpr2_block_qty',
    'tpr3_box_qty',
    'tpr4_pallet_up',
    'sg_days',
    'sg_percent',
    'mfg_date',
    'expiry_date',
    'weight_kg',
    'problem',
    'problem_details',
    'comment',
    'files_json'
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

function buildTelegramMessageFromSite_(data) {
  var lines = [];
  var supplier = String(data && data.supplier ? data.supplier : '').trim();
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
  if (lk) lines.push('🧾 ЛК: ' + lk);
  if (d != null && w != null && h != null && !isNaN(d) && !isNaN(w) && !isNaN(h)) {
    lines.push('📏 Габариты (м): ' + [d, w, h].join(' x '));
  }
  if (weightKg != null && !isNaN(weightKg)) lines.push('⚖️ Вес: ' + weightKg + ' кг');
  if (tpr2 != null && !isNaN(tpr2) && tpr2 > 0) lines.push('🧊 ТПР2 (блок): ' + tpr2);
  if (tpr3 != null && !isNaN(tpr3)) lines.push('📦 ТПР3 (коробка): ' + tpr3);
  if (tpr4 != null && !isNaN(tpr4)) lines.push('🪵 ТПР4 (паллет): ' + tpr4);
  if (sgDays != null && !isNaN(sgDays)) lines.push('⏳ СГ (дней): ' + sgDays);
  if (sgPercent != null && !isNaN(sgPercent)) lines.push('📈 Процент СГ: ' + sgPercent);
  if (mfgDate) lines.push('🏷️ Дата изготовления: ' + mfgDate);
  if (expiryDate) lines.push('📅 Годен до: ' + expiryDate);
  var prob = resolveProblemDetails_(data);
  if (prob) lines.push('⚠️ Проблема: ' + prob);
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
    if (cache.get(key)) return true;
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