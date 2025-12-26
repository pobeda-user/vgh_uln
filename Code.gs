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

    // ===== ОБРАБОТКА SERVICE UPDATE (например my_chat_member) =====
    // Telegram может присылать обновления без message/callback_query (изменение статуса бота и т.п.)
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
      } catch (_) {
      }

      if (svcChatId) {
        safeSaveUserChatId_(svcChatId);
      }

      if (logSh) {
        var keys = Object.keys(update || {});
        logSh.appendRow([new Date(), 'doPost', 'TELEGRAM_SERVICE_UPDATE', svcChatId, 'Keys: ' + JSON.stringify(keys), '']);
      }
      return ContentService.createTextOutput('ok');
    }
    
    // ===== ОБРАБОТКА TELEGRAM СООБЩЕНИЙ =====
    if (update.message) {
      var message = update.message;
      var chatId = message.chat ? message.chat.id : 'no_chat';
      var messageId = message.message_id;
      var text = String(message.text || '').trim();
      
      // Создаем уникальный ключ для сообщения
      var messageKey = chatId + '_' + messageId;
      
      // Проверка на дубликат (защита от повторной обработки)
      if (messageCache[messageKey]) {
        if (logSh) {
          logSh.appendRow([new Date(), 'doPost', 'DUPLICATE_SKIPPED', chatId, 
            'Already processed: ' + messageId, '']);
        }
        return ContentService.createTextOutput('ok');
      }
      
      // Сохраняем в кэш
      messageCache[messageKey] = timestamp;
      
      // Очищаем старые записи из кэша (больше 5 минут)
      cleanMessageCache_();
      
      // Логируем детали сообщения
      if (logSh) {
        logSh.appendRow([new Date(), 'doPost', 'TELEGRAM_MSG', chatId, 
          'Text: "' + text + '"', 'MsgID: ' + messageId]);
      }
      
      // Вызываем обработчик сообщений
      handleMessage_(message);
      
      // ВСЕГДА возвращаем ответ для Telegram
      return ContentService.createTextOutput('ok');
    }
    
    // ===== ОБРАБОТКА CALLBACK QUERIES =====
    if (update.callback_query) {
      var callback = update.callback_query;
      var userId = callback.from ? callback.from.id : 'no_user';
      
      if (logSh) {
        logSh.appendRow([new Date(), 'callbackQuery', 'RECEIVED', 
          callback.from ? callback.from.id : '', 
          'Data: ' + (callback.data || 'none'), '']);
      }
      
      handleCallbackQuery_(callback);
      return ContentService.createTextOutput('ok');
    }
    
    // ===== ОБРАБОТКА ДАННЫХ С САЙТА PWA =====
    if (update.clientTs) {
      if (logSh) {
        logSh.appendRow([new Date(), 'doPost', 'SITE_SUBMIT', '', 
          'clientTs: ' + update.clientTs, '']);
      }
      
      // Эта функция возвращает JSON
      return handleSiteSubmit_(update);
    }
    
    // ===== НЕИЗВЕСТНЫЙ ФОРМАТ =====
    if (logSh) {
      logSh.appendRow([new Date(), 'doPost', 'UNKNOWN_FORMAT', '', 
        'Keys: ' + JSON.stringify(Object.keys(update)), 
        JSON.stringify(update).substring(0, 200)]);
    }
    
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
  var messageId = message.message_id;
  
  // Логируем входящее сообщение
  var logSh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_LOGS);
  if (logSh) {
    logSh.appendRow([new Date(), 'handleMessage', 'INCOMING', chatId, 
      'Text: "' + text + '" | Type: ' + chatType, 'MsgID: ' + messageId]);
  }
  
  // Только приватные чаты
  if (chatType !== 'private') {
    if (logSh) {
      logSh.appendRow([new Date(), 'handleMessage', 'IGNORED_NON_PRIVATE', chatId, 
        'Chat type: ' + chatType, '']);
    }
    return;
  }
  
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  
  if (!botToken) {
    if (logSh) {
      logSh.appendRow([new Date(), 'handleMessage', 'ERROR_NO_TOKEN', chatId, 
        'Bot token not found in properties', '']);
    }
    return;
  }
  
  // Логируем команду в основную таблицу логов
  logToSheet_(chatId, text);
  
  // Обработка команд
  if (text.indexOf('/start') === 0) {
    if (logSh) {
      logSh.appendRow([new Date(), 'handleMessage', 'PROCESSING_START', chatId, '', '']);
    }
    
    try {
      var welcomeMessage = buildWelcomeMessage_();
      sendTelegram_(botToken, chatId, welcomeMessage);
      
      if (logSh) {
        logSh.appendRow([new Date(), 'handleMessage', 'START_SENT', chatId, 
          'Welcome message sent', '']);
      }
      
      // Логируем событие
      safeLogEvent_('telegram', 'start', { chatId: chatId, messageId: messageId }, null);
      
    } catch (error) {
      if (logSh) {
        logSh.appendRow([new Date(), 'handleMessage', 'START_ERROR', chatId, 
          error.toString(), '']);
      }
      logFunctionError_('handleMessage_start', error, { chatId: chatId });
    }
    
  } else if (text.indexOf('/help') === 0) {
    if (logSh) {
      logSh.appendRow([new Date(), 'handleMessage', 'PROCESSING_HELP', chatId, '', '']);
    }
    
    try {
      var helpMessage = buildHelpMessage_();
      sendTelegram_(botToken, chatId, helpMessage);
      
      if (logSh) {
        logSh.appendRow([new Date(), 'handleMessage', 'HELP_SENT', chatId, '', '']);
      }
      safeLogEvent_('telegram', 'help', { chatId: chatId }, null);
      
    } catch (error) {
      if (logSh) {
        logSh.appendRow([new Date(), 'handleMessage', 'HELP_ERROR', chatId, 
          error.toString(), '']);
      }
    }
    
  } else if (text.indexOf('@' + CONFIG.BOT_USERNAME) !== -1) {
    // Упоминание бота
    if (logSh) {
      logSh.appendRow([new Date(), 'handleMessage', 'BOT_MENTION', chatId, '', '']);
    }
    
    try {
      sendTelegram_(botToken, chatId, 'Я бот для приёма ВГХ/проблем. Заполняй форму на сайте — я отправлю данные администратору.');
      safeLogEvent_('telegram', 'mention', { chatId: chatId }, null);
    } catch (error) {
      if (logSh) {
        logSh.appendRow([new Date(), 'handleMessage', 'MENTION_ERROR', chatId, 
          error.toString(), '']);
      }
    }
    
  } else {
    // Любое другое сообщение (не команда)
    if (logSh) {
      logSh.appendRow([new Date(), 'handleMessage', 'UNKNOWN_COMMAND', chatId, 
        'Text: "' + text + '"', '']);
    }
    
    // Сохраняем chat_id для рассылок, но не отвечаем
    safeSaveUserChatId_(chatId);
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
    var driveFolder = DriveApp.getFolderById(cfg.DRIVE_FOLDER_ID);
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
    lk: data && data.lk,
    problem: data && data.problem,
    filesCount: files.length
  }, { payload: data });
  
  // Send to admin
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
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_LOGS);
    if (sh) {
      sh.appendRow([new Date(), 'telegram_command', text, String(chatId), '', '']);
    }
  } catch (e) {
    // Тихая ошибка - не прерываем выполнение
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

function ensureSheet_(ss, sheetName, header) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    if (sheetName === CONFIG.SHEET_BROADCAST) {
      sh.appendRow(['', '', '', '', '']);
    }
    return;
  }

  var existing = sh.getRange(1, 1, 1, header.length).getValues()[0];
  var ok = true;
  for (var i = 0; i < header.length; i++) {
    if (String(existing[i] || '').trim() !== header[i]) {
      ok = false;
      break;
    }
  }
  if (!ok) {
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function logEvent_(source, action, summaryObj, payloadObj) {
  var cfg = getConfig_();
  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  var sh = ss.getSheetByName(cfg.SHEET_LOGS);
  if (!sh) return;

  var chatId = '';
  if (summaryObj && summaryObj.chatId) chatId = String(summaryObj.chatId);

  sh.appendRow([
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
    var cfg = getConfig_();
    var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    var sh = ss.getSheetByName(cfg.SHEET_FUNC_LOGS);
    if (!sh) return;

    var errorText = err ? (err && err.message ? err.message : String(err)) : '';
    var stack = '';
    try {
      if (err && err.stack) stack = String(err.stack);
    } catch (_) {}

    sh.appendRow([
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
  var props = PropertiesService.getScriptProperties();
  var out = {};
  for (var k in CONFIG) out[k] = CONFIG[k];

  var spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (spreadsheetId) out.SPREADSHEET_ID = spreadsheetId;

  var folderId = props.getProperty('DRIVE_FOLDER_ID');
  if (folderId) out.DRIVE_FOLDER_ID = folderId;

  var botUsername = props.getProperty('BOT_USERNAME');
  if (botUsername) out.BOT_USERNAME = botUsername;

  var sheetMain = props.getProperty('SHEET_MAIN');
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

// Дополнительные служебные функции
function testBot() {
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  var adminChatId = props.getProperty(CONFIG.PROP_ADMIN_CHAT_ID);
  
  if (!botToken || !adminChatId) {
    Logger.log('❌ Токен или chat_id не настроены');
    return;
  }
  
  sendTelegram_(botToken, adminChatId, '🤖 Бот работает! Тестовое сообщение.');
  Logger.log('✅ Тестовое сообщение отправлено');
}

function checkCurrentWebhook() {
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  
  if (!botToken) {
    Logger.log('❌ Токен не найден');
    return;
  }
  
  var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/getWebhookInfo';
  var response = UrlFetchApp.fetch(api);
  var result = JSON.parse(response.getContentText());
  
  Logger.log('Вебхук настроен на: ' + (result.result.url || 'не установлен'));
  Logger.log('Ожидающих обновлений: ' + result.result.pending_update_count);
  
  return result;
}