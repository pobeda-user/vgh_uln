var CONFIG = {
  SPREADSHEET_ID: '1fKgpHZV4MxWm8PP3H7ZXtaJ51kaNlKyGldy52ttijLQ',
  SHEET_MAIN: 'Лист1',
  SHEET_LOGS: 'Логи',
  SHEET_FUNC_LOGS: 'Логи Функции',
  SHEET_PWA_LOGS: 'Лог PWA',
  SHEET_LOGINS: 'Логины',
  SHEET_BROADCAST: 'Рассылка',
  DRIVE_FOLDER_ID: '1srJXtU7mIJTK9R8CNdnjTsfoF5iwOteQ',
  BOT_USERNAME: 'uln_vgh_bot',

  // Properties keys
  PROP_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  PROP_ADMIN_CHAT_ID: 'ADMIN_CHAT_ID',
  PROP_GROUP_CHAT_ID: 'GROUP_CHAT_ID',
  
  // Admin chat IDs (add your admin chat IDs here)
  ADMIN_CHAT_IDS: ['5808009339'] // Replace with actual admin chat IDs
};

// Кэш для отслеживания обработанных сообщений
var messageCache = {};

function doPost(e) {
  try {
    var update = JSON.parse(e.postData.contents);
    
    // ЗАЩИТА ОТ ДУБЛИКАТОВ через update_id (как в code_dr.gs)
    var updateId = update.update_id;
    var lastUpdateId = PropertiesService.getScriptProperties().getProperty('last_update_id');
    
    if (lastUpdateId && updateId != null && updateId <= parseInt(lastUpdateId)) {
      logEvent_('doPost', 'duplicate_skipped', {
        lastUpdateId: lastUpdateId,
        currentUpdateId: updateId
      });
      return ContentService.createTextOutput(JSON.stringify({status: "success", message: "duplicate"}))
        .setMimeType(ContentService.MimeType.JSON)
        .setStatusCode(200);
    }
    
    if (updateId != null) {
      PropertiesService.getScriptProperties().setProperty('last_update_id', updateId.toString());
    }
    
    if (update.message) {
      var message = update.message;
      var chatId = message.chat.id.toString();
      var text = message.text || '';
      var messageId = message.message_id;
      
      logEvent_('doPost', 'message_received', {
        text: text,
        chatId: chatId,
        userId: message.from ? message.from.id : 'unknown',
        messageId: messageId,
        updateId: updateId
      });
      
      if (text.startsWith('/')) {
        logEvent_('doPost', 'command_detected', { text: text });
        handleMessage_(update.message);
        logEvent_('doPost', 'command_handler_completed', { 
          text: text,
          messageId: messageId 
        });
      } else {
        var props = PropertiesService.getScriptProperties();
        var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
        var adminChatId = props.getProperty(CONFIG.PROP_ADMIN_CHAT_ID);
        var groupChatId = props.getProperty(CONFIG.PROP_GROUP_CHAT_ID);
        
        var senderChatId = String(update.message.chat.id);
        
        if (adminChatId && senderChatId === adminChatId) {
          logEvent_('doPost', 'admin_text_message', { text: text.substring(0, 50) });
          handleAdminCommentMessage_(update.message, botToken, adminChatId, groupChatId);
        } else if (groupChatId && senderChatId === groupChatId) {
          logEvent_('doPost', 'group_text_message', { text: text.substring(0, 50) });
          // Функция handleEditFieldMessage_ не определена, используем заглушку
          logEvent_('doPost', 'group_message_received', { text: text.substring(0, 50) });
        } else {
          logEvent_('doPost', 'unknown_chat', { chatId: senderChatId });
        }
      }
    } else if (update.callback_query) {
      logEvent_('doPost', 'callback_received', {
        data: update.callback_query.data,
        userId: update.callback_query.from ? update.callback_query.from.id : 'unknown'
      });
      handleCallbackQuery_(update.callback_query);
    }
    
    logEvent_('doPost', 'success', {
      messageId: update.message ? update.message.message_id : 'no_message',
      chatId: update.message ? update.message.chat.id : 'no_message',
      updateId: updateId
    });
    
    // ПРАВИЛЬНЫЙ ОТВЕТ КАК В code_dr.gs
    return ContentService.createTextOutput(JSON.stringify({status: "success", message: "processed"}))
      .setMimeType(ContentService.MimeType.JSON)
      .setStatusCode(200);
      
  } catch (error) {
    logEvent_('doPost', 'error', {
      error: String(error),
      stack: error.stack ? error.stack : 'no_stack'
    });
    
    // ПРАВИЛЬНЫЙ ОТВЕТ ПРИ ОШИБКЕ КАК В code_dr.gs
    return jsonWithStatus_({status: "success", message: "error_handled"}, 200);
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonWithStatus_(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj || {}))
    .setMimeType(ContentService.MimeType.JSON)
    .setStatusCode(statusCode || 200);
}

// Функция для безопасного получения ключей кэша
function getCacheKeys_() {
  try {
    // В Google Apps Script CacheService не предоставляет метода getKeys()
    // Поэтому просто возвращаем пустой массив
    return [];
  } catch (error) {
    return [];
  }
}

function getConfig_() {
  var config = CONFIG;
  
  // Получаем фактические значения из PropertiesService
  var props = PropertiesService.getScriptProperties();
  config.BOT_TOKEN = String(props.getProperty(config.PROP_BOT_TOKEN) || '').trim();
  config.ADMIN_CHAT_ID = String(props.getProperty(config.PROP_ADMIN_CHAT_ID) || '').trim();
  config.GROUP_CHAT_ID = String(props.getProperty(config.PROP_GROUP_CHAT_ID) || '').trim();
  
  return config;
}

function ensureSheets_() {
  var cfg = getConfig_();
  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  ensureSheet_(ss, cfg.SHEET_LOGS, ['ts', 'source', 'action', 'a', 'b', 'c']);
  ensureSheet_(ss, cfg.SHEET_FUNC_LOGS, ['ts', 'fn', 'level', 'msg', 'json']);
  ensureSheet_(ss, cfg.SHEET_PWA_LOGS, ['ts', 'requestId', 'action', 'result', 'error', 'details']);
  ensureSheet_(ss, cfg.SHEET_LOGINS, ['ФИО', 'Логин', 'Пароль', 'Телефон', 'Chat ID', 'Роль', 'Дата регистрации']);
  ensureSheet_(ss, cfg.SHEET_BROADCAST, ['chat_id', 'enabled', 'name', 'tag', 'note']);
  var main = ss.getSheetByName(cfg.SHEET_MAIN);
  if (!main) main = ss.insertSheet(cfg.SHEET_MAIN);
  ensureHeaderMain_(main);
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}

function ensureHeaderMain_(sh) {
  if (sh.getLastRow() === 0) {
    var header = [
      'Timestamp', 'requestId', 'Поставщик', 'Наименование товара', 'Тип товара', 'ЛК', 'Длина (м)', 'Ширина (м)', 'Высота (м)',
      'ТПР2 (блок)', 'ТПР3 (коробка)', 'ТПР4 (паллет)', 'СГ (дней)', 'Процент СГ', 'Дата изготовления',
      'Годен до', 'Вес (кг)', 'Проблема', 'Детали проблемы', 'Комментарий', 'Файлы', 'Статус',
      'TG msg_id (group)', 'TG msg_id (admin)', 'Номер заявки'
    ];
    sh.appendRow(header);
  }
}

function logEvent_(source, action, summaryObj, payloadObj) {
  var cfg = getConfig_();
  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  var sh = ss.getSheetByName(cfg.SHEET_LOGS);
  if (!sh) return;
  sh.appendRow([new Date(), String(source || ''), String(action || ''), '', safeJsonStringify_(summaryObj || {}), payloadObj ? safeJsonStringify_(payloadObj) : '']);
}

function logFunctionWarn_(fn, msg, extra) {
  try {
    var cfg = getConfig_();
    var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    var sh = ss.getSheetByName(cfg.SHEET_FUNC_LOGS);
    if (!sh) return;
    sh.appendRow([new Date(), String(fn || ''), 'WARN', String(msg || ''), safeJsonStringify_(extra || {})]);
  } catch (_) {}
}

function logPWA_(requestId, action, result, error, details) {
  try {
    var cfg = getConfig_();
    var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    var sh = ss.getSheetByName(cfg.SHEET_PWA_LOGS);
    if (!sh) return;
    sh.appendRow([
      new Date(), 
      String(requestId || ''), 
      String(action || ''), 
      safeJsonStringify_(result || {}), 
      String(error || ''), 
      safeJsonStringify_(details || {})
    ]);
  } catch (_) {}
}

function safeJsonStringify_(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return '';
  }
}

function sendTelegramNotification(chatId, message, parseMode) {
  parseMode = parseMode || 'HTML';
  
  if (!chatId) {
    logEvent_('sendTelegramNotification', 'no_chat_id', {});
    return false;
  }
  
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  
  if (!botToken) {
    logEvent_('sendTelegramNotification', 'no_token', { chatId: chatId });
    return false;
  }
  
  var stringChatId = chatId.toString ? chatId.toString() : String(chatId);
  
  try {
    logEvent_('sendTelegramNotification', 'sending', {
      chatId: stringChatId,
      messageLength: message.length,
      parseMode: parseMode
    });
    
    var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/sendMessage', {
      method: 'post',
      headers: {'Content-Type': 'application/json'},
      payload: JSON.stringify({
        chat_id: stringChatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true
      })
    });
    
    var result = JSON.parse(response.getContentText());
    if (result.ok) {
      logEvent_('sendTelegramNotification', 'success', {
        chatId: stringChatId,
        messageId: result.result && result.result.message_id
      });
      return true;
    } else {
      logEvent_('sendTelegramNotification', 'error', {
        chatId: stringChatId,
        error: result.description || 'Unknown error'
      });
      return false;
    }
  } catch (error) {
    logEvent_('sendTelegramNotification', 'exception', {
      chatId: stringChatId,
      error: String(error)
    });
    return false;
  }
}

function sendTelegramMessage_(botToken, chatId, text, opts) {
  var o = opts || {};
  var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/sendMessage';
  var payload = {
    chat_id: String(chatId),
    text: String(text || ''),
    parse_mode: 'HTML',
    disable_web_page_preview: o.disableWebPagePreview !== false
  };

  if (o.replyToMessageId != null && o.replyToMessageId !== '' && !isNaN(Number(o.replyToMessageId))) {
    payload.reply_to_message_id = Number(o.replyToMessageId);
  }
  if (o.replyMarkup) {
    payload.reply_markup = JSON.stringify(o.replyMarkup);
  }
  
  logEvent_('sendTelegramMessage', 'sending', {
    chatId: String(chatId),
    textLength: String(text || '').length,
    hasReplyMarkup: Boolean(o.replyMarkup)
  });
  
  try {
    var res = UrlFetchApp.fetch(api, {
      method: 'post',
      muteHttpExceptions: true,
      payload: payload
    });
    
    var textOut = res.getContentText() || '';
    var json = JSON.parse(textOut || '{}');
    
    logEvent_('sendTelegramMessage', 'response', {
      chatId: String(chatId),
      responseCode: res.getResponseCode ? res.getResponseCode() : 'unknown',
      ok: Boolean(json && json.ok),
      messageId: json && json.result && json.result.message_id ? json.result.message_id : null,
      errorDescription: json && json.description ? json.description : null
    });
    
    if (json && json.ok && json.result && json.result.message_id != null) {
      return Number(json.result.message_id);
    } else {
      // Логируем ошибку
      logFunctionWarn_('sendTelegramMessage_', 'Telegram API error', {
        chatId: String(chatId),
        ok: Boolean(json && json.ok),
        description: String((json && json.description) ? json.description : ''),
        responseCode: res.getResponseCode ? res.getResponseCode() : ''
      });
      return null;
    }
  } catch (error) {
    logFunctionWarn_('sendTelegramMessage_', 'Exception', {
      error: String(error),
      chatId: String(chatId)
    });
    return null;
  }
}

function handleMessage_(message) {
  try {
    var chat = message && message.chat ? message.chat : null;
    var text = message && message.text ? String(message.text).trim() : '';
    
    logEvent_('handleMessage', 'processing', {
      text: text,
      chatId: chat ? chat.id : 'unknown',
      userId: message && message.from ? message.from.id : 'unknown'
    });
    
    if (!chat || !chat.id) return;
    
    var props = PropertiesService.getScriptProperties();
    var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
    
    if (!botToken) {
      logEvent_('handleMessage', 'no_token', { chatId: chat.id });
      return;
    }
    
    if (text === '/start') {
      logEvent_('handleMessage', 'start_command_detected', { chatId: chat.id });
      
      // Проверяем является ли пользователь админом
      var props = PropertiesService.getScriptProperties();
      var adminChatId = props.getProperty(CONFIG.PROP_ADMIN_CHAT_ID);
      var isAdmin = adminChatId && String(chat.id) === String(adminChatId);
      
      if (isAdmin) {
        // Приветствие для админа
        var adminWelcomeText = '� <b>Добро пожаловать, Администратор!</b>\n\n';
        adminWelcomeText += '📋 <b>Доступные функции:</b>\n';
        adminWelcomeText += '/start - Показать это сообщение\n';
        adminWelcomeText += '/clear - Очистить сессии редактирования\n';
        adminWelcomeText += '/apps - Показать незавершенные заявки\n\n';
        adminWelcomeText += '🔧 Управление заявками на ВГХ доступно через кнопки ниже.';
        
        var adminReplyMarkup = {
          inline_keyboard: [[
            { text: '📝 Мои заявки', callback_data: 'admin_my_apps' }
          ]]
        };
        
        sendTelegramMessage_(botToken, chat.id, adminWelcomeText, {
          replyMarkup: adminReplyMarkup
        });
        
        logEvent_('handleMessage', 'admin_welcome_sent', { chatId: chat.id });
      } else {
        // Приветствие для обычного пользователя
        var userWelcomeText = '👋 <b>Добро пожаловать!</b>\n\n';
        userWelcomeText += '✅ <b>Вы зарегистрированы</b>, спасибо что пользуетесь ботом.\n\n';
        userWelcomeText += '📝 <b>Регистрировать ваши заявки на ВГХ</b> вы можете во внутренней общей группе приемки.\n\n';
        userWelcomeText += '🔍 <b>Статус ваших заявок:</b>\n';
        userWelcomeText += 'Проверить текущие заявки можно через кнопку ниже.';
        
        var userReplyMarkup = {
          inline_keyboard: [[
            { text: '📋 Не забитые ВГХ', callback_data: 'user_my_apps' }
          ]]
        };
        
        sendTelegramMessage_(botToken, chat.id, userWelcomeText, {
          replyMarkup: userReplyMarkup
        });
        
        logEvent_('handleMessage', 'user_welcome_sent', { chatId: chat.id });
      }
      
    } else if (text === '/clear') {
      logEvent_('handleMessage', 'clear_command_detected', { chatId: chat.id });
      handleClearCommand_(message);
      
    } else if (text === '/apps') {
      logEvent_('handleMessage', 'apps_command_detected', { chatId: chat.id });
      handleAppsCommand_(message);
      
    } else {
      logEvent_('handleMessage', 'unknown_command', {
        text: text,
        chatId: chat ? chat.id : 'unknown'
      });
      sendTelegramMessage_(botToken, chat.id, '❌ Неизвестная команда. Используйте /start для справки.');
    }
    
  } catch (error) {
    logEvent_('handleMessage', 'error', {
      error: String(error),
      text: message && message.text ? message.text : 'no_text'
    });
  }
}

function handleAppsCommand_(message) {
  try {
    var chat = message && message.chat ? message.chat : null;
    if (!chat || !chat.id) {
      logEvent_('handleAppsCommand', 'no_chat', {});
      return;
    }
    
    var props = PropertiesService.getScriptProperties();
    var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
    var groupChatId = props.getProperty(CONFIG.PROP_GROUP_CHAT_ID);
    
    logEvent_('handleAppsCommand', 'checking_config', {
      hasBotToken: Boolean(botToken),
      hasGroupChatId: Boolean(groupChatId),
      chatId: chat.id,
      groupChatId: groupChatId
    });
    
    if (!botToken) {
      logEvent_('handleAppsCommand', 'missing_config', {
        hasBotToken: Boolean(botToken)
      });
      return;
    }
    
    logEvent_('handleAppsCommand', 'calling_showPendingApplications', {
      chatId: chat.id
    });
    
    // Показываем незавершенные заявки
    showPendingApplications_(botToken, chat.id);
    
    logEvent_('apps_command', 'executed', {
      chatId: String(chat.id)
    });
    
  } catch (error) {
    logEvent_('handleAppsCommand', 'error', {
      error: String(error),
      stack: error.stack ? error.stack : 'no_stack'
    });
    logFunctionWarn_('handleAppsCommand_', 'Error', {
      error: String(error)
    });
  }
}

function handleClearCommand_(message) {
  try {
    var chat = message && message.chat ? message.chat : null;
    if (!chat || !chat.id) return;
    
    var props = PropertiesService.getScriptProperties();
    var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
    
    logEvent_('handleClearCommand', 'started', {
      chatId: chat.id,
      hasBotToken: Boolean(botToken)
    });
    
    if (!botToken) return;
    
    // ОЧИСТКА КЭША
    var cache = CacheService.getScriptCache();
    var cleared = 0;
    
    // Очищаем сессии редактирования
    for (var i = 1; i <= 1000; i++) {
      var editKey = 'edit_field_' + i;
      var commentKey = 'await_comment_' + i;
      
      if (cache.get(editKey)) {
        cache.remove(editKey);
        cleared++;
      }
      
      if (cache.get(commentKey)) {
        cache.remove(commentKey);
        cleared++;
      }
    }
    
    // Очищаем callback кэш
    for (var j = 1; j <= 1000; j++) {
      var cbKey = 'cb_' + j;
      if (cache.get(cbKey)) {
        cache.remove(cbKey);
        cleared++;
      }
    }
    
    // ФОРМИРУЕМ ОТВЕТ
    var responseText = '✅ <b>Очистка завершена</b>\n\n';
    responseText += '🧹 Очищено сессий: ' + cleared;
    
    if (cleared === 0) {
      responseText += '\n\nℹ️ Активных сессий не найдено';
    } else {
      responseText += '\n\n🔄 Теперь можно работать';
    }
    
    sendTelegramMessage_(botToken, chat.id, responseText);
    
    logEvent_('handleClearCommand', 'completed', {
      chatId: chat.id,
      cleared: cleared
    });
    
  } catch (error) {
    logEvent_('handleClearCommand', 'error', {
      error: String(error),
      stack: error.stack ? error.stack : 'no_stack'
    });
    
    // Пытаемся отправить сообщение об ошибке
    try {
      var props = PropertiesService.getScriptProperties();
      var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
      if (botToken && message && message.chat && message.chat.id) {
        sendTelegramMessage_(botToken, message.chat.id, '❌ Ошибка при очистке');
      }
    } catch (e) {
      // Nothing
    }
  }
}

// ОПТИМИЗИРОВАННАЯ ОБРАБОТКА CALLBACK - МГНОВЕННЫЙ ОТВЕТ
function handleCallbackQuery_(callback) {
  // СРАЗУ отвечаем на callback
  if (callback && callback.id) {
    var props = PropertiesService.getScriptProperties();
    var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
    
    if (botToken) {
      var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/answerCallbackQuery';
      try {
        UrlFetchApp.fetch(api, {
          method: 'post',
          contentType: 'application/json',
          muteHttpExceptions: true,
          payload: JSON.stringify({ 
            callback_query_id: callback.id,
            text: '⏳ Обрабатываю...',
            show_alert: false
          })
        });
      } catch (e) {}
    }
  }
  
  // Запускаем обработку В ТОМ ЖЕ ВЫПОЛНЕНИИ (не асинхронно)
  try {
    processImmediately_(callback);
  } catch (error) {
    logFunctionWarn_('handleCallbackQuery_', 'Error processing callback', {
      error: String(error),
      callbackId: callback.id
    });
  }
  
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

// ОБРАБОТКА CALLBACK В ТОМ ЖЕ ВЫПОЛНЕНИИ (быстрее)
function processImmediately_(callback) {
  var startTime = new Date().getTime();
  
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  var adminChatId = props.getProperty(CONFIG.PROP_ADMIN_CHAT_ID);
  var groupChatId = props.getProperty(CONFIG.PROP_GROUP_CHAT_ID);
  
  if (!botToken || !adminChatId || !groupChatId) {
    logFunctionWarn_('processImmediately_', 'Missing config', {});
    return;
  }
  
  var data = String(callback && callback.data ? callback.data : '');
  
  // Проверяем дубликат через кэш
  var cache = CacheService.getScriptCache();
  var cacheKey = 'cb_' + callback.id;
  if (cache.get(cacheKey)) {
    return; // Уже обрабатывался
  }
  cache.put(cacheKey, '1', 10); // 10 секунд
  
  // Обрабатываем в зависимости от типа
  if (data.startsWith('group_')) {
    handleGroupCallbackImmediately_(callback, botToken, adminChatId, groupChatId);
  } else if (data.startsWith('admin_comment')) {
    handleAdminComment_(callback, botToken, adminChatId, groupChatId);
  } else if (data.startsWith('edit_field') || data.startsWith('edit_cancel')) {
    handleEditFieldCallback_(callback, botToken, adminChatId, groupChatId);
  } else if (data.startsWith('admin_comment_cancel')) {
    handleAdminCommentCancel_(callback, botToken, adminChatId, groupChatId);
  } else if (data.startsWith('clear_sessions')) {
    handleClearSessions_(callback, botToken, adminChatId, groupChatId);
  } else if (data.startsWith('select_app')) {
    handleSelectApplication_(callback, botToken, adminChatId, groupChatId);
  } else if (data.startsWith('quick_select')) {
    handleQuickSelect_(callback, botToken, adminChatId, groupChatId);
  } else if (data.startsWith('user_view_app')) {
    handleUserViewApp_(callback, botToken, adminChatId, groupChatId);
  } else if (data === 'admin_my_apps') {
    handleAdminMyApps_(callback, botToken, adminChatId, groupChatId);
  } else if (data === 'user_my_apps') {
    handleUserMyApps_(callback, botToken, adminChatId, groupChatId);
  } else {
    handleAdminCallbackImmediately_(callback, botToken, adminChatId, groupChatId);
  }
  
  var endTime = new Date().getTime();
  var duration = endTime - startTime;
  
  if (duration > 1000) {
    logFunctionWarn_('processImmediately_', 'Slow callback processing', {
      duration: duration + 'ms',
      data: data
    });
  }
}

// УСКОРЕННАЯ ОБРАБОТКА CALLBACK ОТ АДМИНА
function handleAdminCallbackImmediately_(callback, botToken, adminChatId, groupChatId) {
  var fromId = callback && callback.from && callback.from.id != null ? String(callback.from.id) : '';
  if (fromId !== String(adminChatId)) return;
  
  var data = String(callback && callback.data ? callback.data : '');
  var m = data.match(/^(done|rework):(\d+)$/);
  if (!m) return;
  
  var action = m[1];
  var rowNum = parseInt(m[2], 10);
  if (!rowNum || rowNum < 2) return;
  
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    // БЫСТРОЕ ЧТЕНИЕ ДАННЫХ (минимальное)
    var groupMsgId = sh.getRange(rowNum, 22).getValue();
    var appNumber = sh.getRange(rowNum, 24).getValue();
    
    // Обновляем статус
    var newStatus = action === 'done' ? 'DONE' : 'REWORK';
    sh.getRange(rowNum, 21).setValue(newStatus);
    
    // Определяем текст для группы
    var groupText = action === 'done' 
      ? '✅ <b>ВГХ внесены</b>, прошу проверить.'
      : '↩️ <b>Статус возвращен</b>, будут внесены правки. Ожидайте изменения.';
    
    // ОТПРАВЛЯЕМ В ГРУППУ (с ответом на сообщение заявки)
    var replyTo = groupMsgId ? Number(groupMsgId) : null;
    sendTelegramMessageFastReply_(botToken, groupChatId, groupText, {
      replyToMessageId: replyTo,
      replyMarkup: {
        inline_keyboard: [[
          { text: '✅ Работает', callback_data: 'group_done:' + rowNum },
          { text: '↩️ Отправить на доработку', callback_data: 'group_rework:' + rowNum }
        ]]
      }
    });
    
    // Обновляем кнопки у админа
    if (callback && callback.message) {
      var adminMsgId = Number(callback.message.message_id);
      var adminText = callback.message.text || '';
      var adminStatusText = newStatus === 'DONE' ? '✅ Отправлено' : '↩️ На доработке';
      
      // Обновляем текст
      if (!adminText.includes('Статус:')) {
        adminText += '\n\nСтатус: ' + adminStatusText;
      } else {
        adminText = adminText.replace(/Статус:.*/, 'Статус: ' + adminStatusText);
      }
      
      // Кнопки для админа
      var adminReplyMarkup = {
        inline_keyboard: [[
          { 
            text: action === 'done' ? '✅ Отправлено' : '✅ Готово', 
            callback_data: 'done:' + rowNum 
          },
          { 
            text: action === 'done' ? '↩️ Вернуть на доработку' : '↩️ На доработке', 
            callback_data: 'rework:' + rowNum 
          }
        ]]
      };
      
      // Редактируем сообщение админа
      editMessageWithKeyboardNow_(botToken, callback.message.chat.id, adminMsgId, adminText, adminReplyMarkup);
    }
    
  } catch (error) {
    logFunctionWarn_('handleAdminCallbackImmediately_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// УСКОРЕННАЯ ОБРАБОТКА CALLBACK ИЗ ГРУППЫ
function handleGroupCallbackImmediately_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  
  // Отладочный лог
  logEvent_('group_callback_debug', 'received', {
    callbackData: data,
    fullCallback: JSON.stringify(callback)
  });
  
  var m = data.match(/^group_(done|rework|edit|send_admin):(\d+)$/);
  if (!m) {
    // Логируем несовпадение
    logEvent_('group_callback_debug', 'no_match', {
      callbackData: data,
      pattern: '^group_(done|rework|edit|send_admin):(\\d+)$'
    });
    return;
  }

  var action = m[1];
  var rowNum = parseInt(m[2], 10);
  if (!rowNum || rowNum < 2) return;
  
  // ЛОГИРУЕМ НАЖАТИЕ КНОПКИ
  logEvent_('group_callback', action, {
    rowNum: rowNum,
    callbackData: data,
    action: action
  });
  
  // Обработка отправки админу
  if (action === 'send_admin') {
    handleSendToAdmin_(callback, botToken, adminChatId, groupChatId, rowNum);
    return;
  }
  
  try {
    // 1. СРАЗУ обновляем кнопки в группе (самое важное для скорости)
    if (callback && callback.message) {
      var groupMsgId = Number(callback.message.message_id);
      
      // Обработка кнопки "Изменить данные"
      if (action === 'edit') {
        // Отправляем форму для изменения данных
        sendEditDataForm_(botToken, groupChatId, rowNum, groupMsgId);
        return;
      }
      
      // Определяем новые тексты кнопок для done/rework
      var newButtonText, otherButtonText, newCallback, otherCallback;
      
      if (action === 'done') {
        newButtonText = '✅ Отправлено';
        newCallback = 'group_done:' + rowNum;
        otherButtonText = '↩️ Отправить на доработку';
        otherCallback = 'group_rework:' + rowNum;
      } else {
        newButtonText = '↩️ Отправлено на доработку';
        newCallback = 'group_rework:' + rowNum;
        otherButtonText = '✅ Работает';
        otherCallback = 'group_done:' + rowNum;
      }
      
      var groupReplyMarkup = {
        inline_keyboard: [[
          { text: newButtonText, callback_data: newCallback },
          { text: otherButtonText, callback_data: otherCallback }
        ]]
      };
      
      // СРАЗУ обновляем кнопки
      editMessageReplyMarkupNow_(botToken, callback.message.chat.id, groupMsgId, groupReplyMarkup);
    }
    
    // 2. БЫСТРОЕ обновление статуса (только для done/rework)
    if (action !== 'edit') {
      try {
        var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
        if (!sh) return;
        
        var newStatus = action === 'done' ? 'DONE_GROUP' : 'REWORK_GROUP';
        sh.getRange(rowNum, 21).setValue(newStatus);
      } catch (_) {}
    }
    
    // 3. ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ АДМИНУ СРАЗУ (не асинхронно)
    if (action !== 'edit') {
      try {
        var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
        if (!sh) return;
        
        // Читаем данные для уведомления
        var supplier = sh.getRange(rowNum, 3).getValue();
        var lk = sh.getRange(rowNum, 5).getValue();
        var adminMsgId = sh.getRange(rowNum, 23).getValue();
        
        var fromUser = callback && callback.from ? callback.from : {};
        var userName = fromUser.first_name || fromUser.username || 'Пользователь';
        var userTitle = '';
        
        // Определяем кто это: приемщик или админ
        if (data.startsWith('group_')) {
          userTitle = '👤 Приемщик';
        } else {
          userTitle = '👑 Администратор';
        }
        
        var adminText = '';
        
        if (action === 'done') {
          // При "Работает" - краткое сообщение
          adminText = '✅ <b>Статус изменен</b>\n\nРаботает → Отправлено';
          adminText += '\n\n' + userTitle + ': ' + escapeHtml_(String(userName));
          adminText += '\n🏭 Поставщик: ' + escapeHtml_(String(supplier || ''));
          adminText += '\n🧾 ЛК: ' + escapeHtml_(String(lk || ''));
        } else {
          // При "Отправить на доработку" - полные данные заявки
          adminText = '↩️ <b>Заявка возвращена на доработку</b>\n\nОтправлено → На доработке';
          adminText += '\n\n' + userTitle + ': ' + escapeHtml_(String(userName));
          
          // Получаем все данные строки для полного сообщения
          try {
            var rowData = sh.getRange(rowNum, 1, 1, 24).getValues()[0];
            var appNumber = rowData[23]; // Номер заявки
            
            adminText += '\n\n' + buildFullTelegramMessageFromRowData_(rowData, appNumber);
          } catch (e) {
            // Если не удалось получить полные данные, отправляем базовые
            adminText += '\n\n🏭 Поставщик: ' + escapeHtml_(String(supplier || ''));
            adminText += '\n🧾 ЛК: ' + escapeHtml_(String(lk || ''));
          }
        }
        
        // Добавляем кнопки для админа
        var adminReplyMarkup = {
          inline_keyboard: [[
            { text: '💬 Добавить комментарий', callback_data: 'admin_comment:' + rowNum }
          ]]
        };
        
        // Отправляем админу
        var replyTo = adminMsgId ? Number(adminMsgId) : null;
        sendTelegramMessageFastReply_(botToken, adminChatId, adminText, {
          replyToMessageId: replyTo,
          replyMarkup: adminReplyMarkup
        });
        
      } catch (error) {
        logFunctionWarn_('handleGroupCallbackImmediately_', 'Admin notify error', {
          error: String(error),
          rowNum: rowNum
        });
      }
    }
    
    // ВЫХОДИМ - все сделано
    return;
    
  } catch (error) {
    logFunctionWarn_('handleGroupCallbackImmediately_', 'Error', {
      error: String(error),
      data: data
    });
  }
}

// Функция для обработки отправки админу
function handleSendToAdmin_(callback, botToken, adminChatId, groupChatId, rowNum) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    // Получаем данные заявки
    var rowData = sh.getRange(rowNum, 1, 1, 25).getValues()[0];
    var appNumber = rowData[24]; // Номер заявки
    var adminMsgId = rowData[23]; // ID сообщения админа
    
    // Формируем полное сообщение для админа
    var adminText = buildFullTelegramMessageFromRowData_(rowData, appNumber);
    
    // Добавляем кнопки для админа
    var adminReplyMarkup = {
      inline_keyboard: [[
        { text: '✅ Готово', callback_data: 'done:' + rowNum },
        { text: '↩️ Вернуть на доработку', callback_data: 'rework:' + rowNum }
      ]]
    };
    
    // Обновляем сообщение админа с кнопками
    if (adminMsgId) {
      editMessageWithKeyboardNow_(botToken, adminChatId, Number(adminMsgId), adminText, adminReplyMarkup);
    } else {
      // Если ID сообщения нет, отправляем новое
      var newAdminMsgId = sendTelegramMessage_(botToken, adminChatId, adminText, {
        disableWebPagePreview: true,
        replyMarkup: adminReplyMarkup
      });
      if (newAdminMsgId) {
        sh.getRange(rowNum, 24).setValue(newAdminMsgId); // Обновляем ID сообщения
      }
    }
    
    // Обновляем кнопки в группе - убираем "Отправить админу"
    if (callback && callback.message) {
      var groupReplyMarkup = {
        inline_keyboard: [[
          { text: '✏️ Изменить данные', callback_data: 'group_edit:' + rowNum }
        ]]
      };
      
      editMessageReplyMarkupNow_(botToken, callback.message.chat.id, 
        Number(callback.message.message_id), groupReplyMarkup);
    }
    
    // Обновляем статус
    sh.getRange(rowNum, 22).setValue('SENT_TO_ADMIN');
    
    logEvent_('send_to_admin', 'success', {
      rowNum: rowNum,
      appNumber: appNumber
    });
    
  } catch (error) {
    logFunctionWarn_('handleSendToAdmin_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// ОЧЕНЬ БЫСТРАЯ ФУНКЦИЯ ОТПРАВКИ С ОТВЕТОМ
function sendTelegramMessageFastReply_(botToken, chatId, text, opts) {
  try {
    var o = opts || {};
    var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/sendMessage';
    var payload = {
      chat_id: String(chatId),
      text: String(text || ''),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    
    if (o.replyToMessageId != null && !isNaN(Number(o.replyToMessageId))) {
      payload.reply_to_message_id = Number(o.replyToMessageId);
    }
    
    if (o.replyMarkup) {
      payload.reply_markup = JSON.stringify(o.replyMarkup);
    }
    
    // Ультра-быстрая отправка с минимальным таймаутом
    UrlFetchApp.fetch(api, {
      method: 'post',
      muteHttpExceptions: true,
      payload: payload,
      timeout: 1500 // Только 1.5 секунды!
    });
    
  } catch (_) {
    // Игнорируем ошибки при быстрой отправке
  }
}

// ОЧЕНЬ БЫСТРОЕ ОБНОВЛЕНИЕ КНОПОК
function editMessageReplyMarkupNow_(botToken, chatId, messageId, replyMarkup) {
  try {
    var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/editMessageReplyMarkup';
    var payload = {
      chat_id: String(chatId),
      message_id: String(messageId)
    };
    
    if (replyMarkup) {
      payload.reply_markup = JSON.stringify(replyMarkup);
    }
    
    // Ультра-быстрое обновление
    UrlFetchApp.fetch(api, {
      method: 'post',
      muteHttpExceptions: true,
      payload: payload,
      timeout: 1500 // Только 1.5 секунды!
    });
    
  } catch (_) {
    // Игнорируем ошибки
  }
}

// Быстрое редактирование сообщения с клавиатурой
function editMessageWithKeyboardNow_(botToken, chatId, messageId, newText, replyMarkup) {
  try {
    var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/editMessageText';
    var payload = {
      chat_id: String(chatId),
      message_id: String(messageId),
      text: String(newText || ''),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    
    if (replyMarkup) {
      payload.reply_markup = JSON.stringify(replyMarkup);
    }
    
    UrlFetchApp.fetch(api, {
      method: 'post',
      muteHttpExceptions: true,
      payload: payload,
      timeout: 1500 // Только 1.5 секунды!
    });
    
  } catch (_) {}
}
// Функция для формирования ПОЛНОГО сообщения с ВСЕМИ данными ВГХ
function buildFullTelegramMessageFromRowData_(rowData, appNumber) {
  var lines = [];
  
  if (appNumber) {
    lines.push('📝 Заявка ' + appNumber + ' на доработку');
  } else {
    lines.push('📝 Заявка на доработку');
  }
  
  // Правильные индексы согласно структуре таблицы
  lines.push('🏭 Поставщик: ' + escapeHtml_(String(rowData[3] || '')));  // Столбец D
  lines.push('🏷️ Тип товара: ' + escapeHtml_(String(rowData[2] || ''))); // Столбец C  
  lines.push('🧾 ЛК: ' + escapeHtml_(String(rowData[4] || '')));    // Столбец E
  
  if (rowData[5] && rowData[6] && rowData[7]) {
    lines.push('📏 Габариты (м):');
    lines.push('Длина-Ширина-Высота');
    lines.push('<b>' + rowData[5] + '</b>');  // Длина
    lines.push('<b>' + rowData[6] + '</b>');  // Ширина  
    lines.push('<b>' + rowData[7] + '</b>');  // Высота
  }
  
  if (rowData[15]) lines.push('⚖️ Вес: ' + rowData[15] + ' кг');
  if (rowData[8]) lines.push('🧊 ТПР2 (блок): ' + rowData[8]);
  if (rowData[9]) lines.push('📦 ТПР3 (коробка): ' + rowData[9]);
  if (rowData[10]) {
    var calculatedTpr4 = rowData[10];
    
    if (rowData[9] && rowData[9] > 0) {
      calculatedTpr4 = rowData[9] * rowData[10];
    }
    
    lines.push('🪵 ТПР4 (паллет): ' + calculatedTpr4);
  }
  
  if (rowData[11]) lines.push('⏳ СГ (дней): ' + rowData[11]);
  if (rowData[12]) lines.push('📈 Процент СГ: ' + rowData[12]);
  
  // Форматируем даты в dd.mm.yyyy
  if (rowData[13]) {
    var mfgDate = formatDateToDDMMYYYY_(String(rowData[13]));
    lines.push('🏷️ Дата изготовления: ' + mfgDate);
  }
  
  if (rowData[14]) {
    var expiryDate = formatDateToDDMMYYYY_(String(rowData[14]));
    lines.push('📅 Годен до: ' + expiryDate);
  }
  
  if (rowData[16]) lines.push('⚠️ Проблема: <b>' + escapeHtml_(String(rowData[16])) + '</b>');
  if (rowData[17]) lines.push('🔍 Детали проблемы: ' + escapeHtml_(String(rowData[17])));
  if (rowData[18]) lines.push('💬 Комментарий: ' + escapeHtml_(String(rowData[18])));
  
  return lines.join('\n');
}

// Функция для форматирования даты в dd.mm.yyyy
function formatDateToDDMMYYYY_(dateString) {
  if (!dateString) return '';
  
  try {
    // Формат yyyy-mm-dd
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      var parts = dateString.split('-');
      return parts[2] + '.' + parts[1] + '.' + parts[0];
    }
    
    // Формат dd.mm.yyyy (уже правильный)
    if (dateString.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      return dateString;
    }
    
    // Формат dd/mm/yyyy
    if (dateString.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      var parts = dateString.split('/');
      return parts[0] + '.' + parts[1] + '.' + parts[2];
    }
    
    // Пробуем распарсить как Date
    var date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      var day = String(date.getDate()).padStart(2, '0');
      var month = String(date.getMonth() + 1).padStart(2, '0');
      var year = date.getFullYear();
      return day + '.' + month + '.' + year;
    }
    
    return dateString;
  } catch (e) {
    return dateString;
  }
}

// Функция для генерации номера заявки
function generateApplicationNumber_() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var counter = scriptProperties.getProperty('APPLICATION_COUNTER');
  
  if (!counter) {
    counter = '111'; // Начальное значение
  } else {
    counter = String(parseInt(counter, 10) + 1);
  }
  
  scriptProperties.setProperty('APPLICATION_COUNTER', counter);
  return 'ULN' + counter;
}

function handleSiteSubmit_(data) {
  var cfg = getConfig_();
  ensureSheets_();
  
  var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  var sh = ss.getSheetByName(cfg.SHEET_MAIN);
  if (!sh) throw new Error('Sheet not found: ' + cfg.SHEET_MAIN);

  ensureHeaderMain_(sh);

  // Server-side dedupe by requestId
  var requestId = String(data && data.requestId ? data.requestId : '').trim();
  if (requestId) {
    try {
      var cache = CacheService.getScriptCache();
      var key = 'site_req_' + requestId;
      if (cache.get(key)) {
        var result = { ok: true, deduped: true, source: 'cache' };
        logPWA_(requestId, 'submit_duplicate', result, '', { source: 'cache' });
        return result;
      }
    } catch (_) {}

    try {
      var last = sh.getLastRow();
      if (last >= 2) {
        var rng = sh.getRange(2, 2, last - 1, 1);
        var found = rng.createTextFinder(requestId).matchEntireCell(true).findNext();
        if (found) {
          try {
            var cache2 = CacheService.getScriptCache();
            cache2.put('site_req_' + requestId, '1', 21600);
          } catch (_) {}
          var result = { ok: true, deduped: true, source: 'sheet' };
          logPWA_(requestId, 'submit_duplicate', result, '', { source: 'sheet' });
          return result;
        }
      }
    } catch (_) {}
  }
  
  var files = Array.isArray(data.files) ? data.files : [];
  var uploaded = [];
  if (files.length) {
    var rootFolder = DriveApp.getFolderById(cfg.DRIVE_FOLDER_ID);

    var now = new Date();
    var dateFolderName = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var supplierName = safeFolderName_(String(data && data.supplier ? data.supplier : '').trim()) || 'без поставщика';
    var driveFolder = getOrCreateSubfolder_(getOrCreateSubfolder_(rootFolder, dateFolderName), supplierName);
    
    // Сохраняем URL папки для всех файлов
    var folderUrl = driveFolder.getUrl();
    
    for (var i = 0; i < files.length; i++) {
      var f = files[i] || {};
      var bytes = Utilities.base64Decode(String(f.dataBase64 || ''));
      var blob = Utilities.newBlob(bytes, String(f.mimeType || 'application/octet-stream'), String(f.name || ('file_' + (i + 1))));
      var file = driveFolder.createFile(blob);
      uploaded.push({ 
        field: String(f.field || ''), 
        url: file.getUrl(), 
        name: file.getName(),
        folderUrl: folderUrl // Добавляем URL папки к каждому файлу
      });
    }
  }

  if (requestId) {
    try {
      var cache3 = CacheService.getScriptCache();
      cache3.put('site_req_' + requestId, '1', 21600);
    } catch (_) {}
  }
  
  // Генерируем номер заявки
  var appNumber = generateApplicationNumber_();
  
  var row = buildMainRow_(data, uploaded);
  // Добавляем номер заявки в конец массива (индекс 25)
  row.push(appNumber);
  
  // Добавляем строку
  sh.appendRow(row);
  var rowNum = sh.getLastRow();
  
  logEvent_('site', 'submit', {
    supplier: data && data.supplier,
    problem: data && data.problem,
    filesCount: files.length,
    appNumber: appNumber
  }, { payload: data });

  // Используем значения из getConfig_()
  if (cfg.BOT_TOKEN && cfg.ADMIN_CHAT_ID && cfg.GROUP_CHAT_ID) {
    // Добавляем информацию о загруженных файлах в data
    data.uploaded = uploaded;
    
    var message = buildTelegramMessageFromSite_(data, appNumber);

    // Ищем chat ID пользователя по номеру телефона
    var userChatId = findUserChatIdByPhone_(data.userPhone);

    // 1) Send to user who created the request (if chat ID found)
    var userMsgId = null;
    if (userChatId) {
      userMsgId = sendTelegramMessageWithPhotos_(cfg.BOT_TOKEN, userChatId, message, uploaded, { 
        disableWebPagePreview: true,
        replyMarkup: {
          inline_keyboard: [[
            { text: '✏️ Изменить данные', callback_data: 'user_edit:' + String(rowNum) }
          ], [
            { text: '📤 Отправить админу', callback_data: 'user_send_admin:' + String(rowNum) }
          ]]
        }
      });
    }

    // 2) Send to group with photos and edit button
    var groupMsgId = sendTelegramMessageWithPhotos_(cfg.BOT_TOKEN, cfg.GROUP_CHAT_ID, message, uploaded, { 
      disableWebPagePreview: true,
      replyMarkup: {
        inline_keyboard: [[
          { text: '✏️ Изменить данные', callback_data: 'group_edit:' + String(rowNum) }
        ], [
          { text: '📤 Отправить админу', callback_data: 'group_send_admin:' + String(rowNum) }
        ]]
      }
    });

    // 3) Send to admin WITHOUT photos initially
    var adminMsgId = sendTelegramMessage_(cfg.BOT_TOKEN, cfg.ADMIN_CHAT_ID, message, {
      disableWebPagePreview: true
    });

    // Используем правильные индексы (нумерация с 1, а не с 0)
    // Индекс 22 в массиве = колонка W (Статус)
    // Индекс 23 в массиве = колонка X (TG msg_id group)
    // Индекс 24 в массиве = колонка Y (TG msg_id admin)
    // Индекс 25 в массиве = колонка Z (Номер заявки)
    
    // Но row уже содержит appNumber на позиции 25 (индекс 24 в 0-based)
    // Обновляем только сообщения и статус
    
    // Статус в колонке W (индекс 22 в 0-based, 23 в 1-based)
    sh.getRange(rowNum, 23).setValue('NEW');
    
    // Сообщение группы в колонке X (индекс 23 в 0-based, 24 в 1-based)
    if (groupMsgId) sh.getRange(rowNum, 24).setValue(groupMsgId);
    
    // Сообщение админа в колонке Y (индекс 24 в 0-based, 25 в 1-based)
    if (adminMsgId) sh.getRange(rowNum, 25).setValue(adminMsgId);

    if (!groupMsgId || !adminMsgId) {
      logFunctionWarn_('handleSiteSubmit_', 'Telegram send returned null message_id', {
        rowNum: rowNum,
        hasGroupMsgId: Boolean(groupMsgId),
        hasAdminMsgId: Boolean(adminMsgId)
      });
    }
  } else {
    logFunctionWarn_('handleSiteSubmit_', 'Telegram token or chat IDs not set', {
      hasToken: Boolean(cfg.BOT_TOKEN),
      hasAdminChatId: Boolean(cfg.ADMIN_CHAT_ID),
      hasGroupChatId: Boolean(cfg.GROUP_CHAT_ID)
    });
  }

  var result = { ok: true, appNumber: appNumber, rowNum: rowNum };
  
  // Логируем успешную обработку в PWA лог
  logPWA_(requestId, 'submit_success', result, '', {
    supplier: data && data.supplier,
    filesCount: files.length,
    groupMsgId: groupMsgId,
    adminMsgId: adminMsgId
  });

  return result;
}

function buildMainRow_(data, uploaded) {
  var ts = new Date();
  var details = resolveProblemDetails_(data);
  
  // Форматируем даты в dd.mm.yyyy
  var mfgDate = formatDateToDDMMYYYY_(String(data.mfgDate || ''));
  var expiryDate = formatDateToDDMMYYYY_(String(data.expiryDate || ''));

  return [
    ts,
    String(data.requestId || ''),
    String(data.supplier || ''),
    String(data.productName || ''), // Новое поле: Наименование товара
    productTypeLabel_(data && data.productType != null ? data.productType : ''),
    String(data.lk || ''),
    Number(data.d_m || 0),
    Number(data.w_m || 0),
    Number(data.h_m || 0),
    data.tpr2 == null ? '' : Number(data.tpr2),
    Number(data.tpr3 || 0),
    Number(data.tpr4 || 0),
    Number(data.sgDays || 0),
    data.sgPercent == null ? '' : Number(data.sgPercent),
    mfgDate,
    expiryDate,
    Number(data.weightKg || 0),
    String(data.problem || ''),
    details,
    String(data.comment || ''),
    JSON.stringify(uploaded),
    '',
    '',
    '',
    // Добавляем информацию о пользователе
    String(data.userFio || ''),
    String(data.userPhone || ''),
    String(data.userId || '')
  ];
}

function getOrCreateSubfolder_(parent, name) {
  var safeName = safeFolderName_(name);
  var folders = parent.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    if (folder.getName() === safeName) {
      return folder;
    }
  }
  return parent.createFolder(safeName);
}

function resolveProblemDetails_(data) {
  var problem = data && data.problem ? String(data.problem).trim() : '';
  if (!problem) return '';
  
  var details = [];
  if (problem === 'wrong_tpr') {
    var tpr2 = data && data.tpr2 != null ? Number(data.tpr2) : null;
    var tpr3 = data && data.tpr3 != null ? Number(data.tpr3) : null;
    var tpr4 = data && data.tpr4 != null ? Number(data.tpr4) : null;
    if (tpr2 != null && !isNaN(tpr2)) details.push('ТПР2: ' + tpr2);
    if (tpr3 != null && !isNaN(tpr3)) details.push('ТПР3: ' + tpr3);
    if (tpr4 != null && !isNaN(tpr4)) details.push('ТПР4: ' + tpr4);
  }
  return details.join(', ');
}

function sendTelegram_(botToken, chatId, text, options) {
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
      var count = parseInt(cached) || 1;
      cache.put(key, String(count + 1), 21600);
      
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

// Функция для ускорения кнопок в группе
function optimizeGroupButtons() {
  var cache = CacheService.getScriptCache();
  cache.removeAll(['cb_*']);
  Logger.log('✅ Кэш callback очищен');
  
  // Сбрасываем вебхук для быстрой работы
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  
  if (botToken) {
    var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/getMe';
    try {
      var response = UrlFetchApp.fetch(api);
      var result = JSON.parse(response.getContentText());
      if (result.ok) {
        Logger.log('✅ Бот доступен: ' + result.result.username);
      }
    } catch (e) {
      Logger.log('❌ Ошибка проверки бота: ' + e);
    }
  }
  
  return 'Оптимизация завершена';
}

// Инициализация счетчика заявок
function initializeApplicationCounter() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
  
  if (!sh) return;
  
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var maxNumber = 110;
    
    for (var i = 2; i <= lastRow; i++) {
      var appNumber = sh.getRange(i, 24).getValue();
      if (appNumber && appNumber.toString().startsWith('ULN')) {
        var num = parseInt(appNumber.toString().replace('ULN', ''), 10);
        if (num > maxNumber) {
          maxNumber = num;
        }
      }
    }
    
    scriptProperties.setProperty('APPLICATION_COUNTER', maxNumber.toString());
    Logger.log('✅ Счетчик заявок: ULN' + maxNumber);
  } else {
    scriptProperties.setProperty('APPLICATION_COUNTER', '111');
    Logger.log('✅ Счетчик заявок: ULN111');
  }
}

// Инициализация системы
function initializeSystem() {
  ensureSheets_();
  initializeApplicationCounter();
  optimizeGroupButtons();
  Logger.log('✅ Система инициализирована и оптимизирована');
}

// Тестовая функция
function testCallbackSpeed() {
  Logger.log('🧪 Тест скорости кнопок...');
  
  // Проверяем конфигурацию
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty(CONFIG.PROP_BOT_TOKEN);
  var adminChatId = props.getProperty(CONFIG.PROP_ADMIN_CHAT_ID);
  var groupChatId = props.getProperty(CONFIG.PROP_GROUP_CHAT_ID);
  
  Logger.log('Bot Token: ' + (botToken ? '✅' : '❌'));
  Logger.log('Admin Chat ID: ' + (adminChatId ? '✅' : '❌'));
  Logger.log('Group Chat ID: ' + (groupChatId ? '✅' : '❌'));
  
  // Проверяем таблицу
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
  
  if (sh) {
    var lastRow = sh.getLastRow();
    Logger.log('Заявок в таблице: ' + (lastRow - 1));
    
    if (lastRow > 1) {
      var appNumber = sh.getRange(lastRow, 24).getValue();
      Logger.log('Последняя заявка: ' + (appNumber || 'нет номера'));
    }
  }
  
  return 'Тест завершен';
}

// Функция для отправки формы редактирования данных (УЛЬТРА-БЫСТРАЯ)
function sendEditDataForm_(botToken, chatId, rowNum, replyToMessageId) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    // ПОЛНОЕ чтение данных для корректного отображения
    var rowData = sh.getRange(rowNum, 1, 1, 25).getValues()[0];
    var appNumber = rowData[24];
    
    // Используем правильную функцию для формирования сообщения
    var briefMessage = buildFullTelegramMessageFromRowData_(rowData, appNumber);
    
    // Добавляем меню выбора полей для редактирования
    var editMessage = '\n\n✏️ <b>Редактирование данных заявки</b> ' + (appNumber ? appNumber : '');
    editMessage += '\n\nВыберите, что нужно изменить:';
    
    var completeMessage = briefMessage + editMessage;
    
    var replyMarkup = {
      inline_keyboard: [
        [
          { text: '🏭 Поставщик', callback_data: 'edit_field:supplier:' + rowNum },
          { text: '🏷️ Тип товара', callback_data: 'edit_field:product_type:' + rowNum }
        ],
        [
          { text: '🧾 ЛК', callback_data: 'edit_field:lk:' + rowNum },
          { text: '📏 Габариты', callback_data: 'edit_field:dimensions:' + rowNum }
        ],
        [
          { text: '⚖️ Вес', callback_data: 'edit_field:weight:' + rowNum },
          { text: '🧊 ТПР2', callback_data: 'edit_field:tpr2:' + rowNum }
        ],
        [
          { text: '📦 ТПР3', callback_data: 'edit_field:tpr3:' + rowNum },
          { text: '🪵 ТПР4', callback_data: 'edit_field:tpr4:' + rowNum }
        ],
        [
          { text: '💬 Комментарий', callback_data: 'edit_field:comment:' + rowNum },
          { text: '❌ Отмена', callback_data: 'edit_cancel:' + rowNum }
        ]
      ]
    };
    
    // УЛЬТРА-БЫСТРОЕ обновление с минимальным таймаутом
    var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/editMessageText';
    var payload = {
      chat_id: String(chatId),
      message_id: String(replyToMessageId),
      text: String(completeMessage || ''),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    
    if (replyMarkup) {
      payload.reply_markup = JSON.stringify(replyMarkup);
    }
    
    UrlFetchApp.fetch(api, {
      method: 'post',
      muteHttpExceptions: true,
      payload: payload,
      timeout: 1000 // УЛЬТРА-быстрый таймаут 1 секунда!
    });
    
  } catch (error) {
    logFunctionWarn_('sendEditDataForm_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// Функция для обработки комментариев админа
function handleAdminComment_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  var m = data.match(/^admin_comment:(\d+)$/);
  if (!m) return;
  
  var rowNum = parseInt(m[1], 10);
  if (!rowNum || rowNum < 2) return;
  
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    // Получаем данные для ответа
    var supplier = sh.getRange(rowNum, 3).getValue();
    var groupMsgId = sh.getRange(rowNum, 22).getValue();
    var appNumber = sh.getRange(rowNum, 24).getValue();
    
    // Отправляем админу форму для ввода комментария
    var message = '💬 <b>Добавить комментарий к заявке</b>';
    message += '\n\n🏭 Поставщик: ' + escapeHtml_(String(supplier || ''));
    if (appNumber) message += '\n📝 Заявка: ' + appNumber;
    message += '\n\nВведите комментарий и отправьте его как сообщение.';
    message += '\n\nИли нажмите кнопку для отмены.';
    
    var replyMarkup = {
      inline_keyboard: [[
        { text: '❌ Отмена', callback_data: 'admin_comment_cancel:' + rowNum }
      ]]
    };
    
    // Обновляем сообщение админа с формой
    if (callback && callback.message) {
      editMessageWithKeyboardNow_(botToken, callback.message.chat.id, 
        Number(callback.message.message_id), message, replyMarkup);
      
      // Сохраняем состояние ожидания комментария
      var cache = CacheService.getScriptCache();
      var cacheKey = 'await_comment_' + rowNum;
      cache.put(cacheKey, '1', 300); // 5 минут на ввод комментария
    }
    
  } catch (error) {
    logFunctionWarn_('handleAdminComment_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// Функция для обработки текстовых сообщений (комментариев админа)
function handleAdminCommentMessage_(message, botToken, adminChatId, groupChatId) {
  var chatId = message && message.chat ? String(message.chat.id) : '';
  if (chatId !== String(adminChatId)) return;
  
  var text = message && message.text ? String(message.text).trim() : '';
  if (!text) return;
  
  try {
    var cache = CacheService.getScriptCache();
    
    // Ищем активную сессию комментария (без использования getCacheKeys_)
    // Проверяем возможные ключи от 1 до 1000
    for (var i = 1; i <= 1000; i++) {
      var key = 'await_comment_' + i;
      var cachedValue = cache.get(key);
      if (cachedValue) {
        var rowNum = i;
        
        logEvent_('handleAdminCommentMessage', 'found_session', {
          key: key,
          rowNum: rowNum,
          cachedValue: cachedValue
        });
        
        // Нашли активную сессию
        var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
        if (!sh) continue;
        
        var supplier = sh.getRange(rowNum, 3).getValue();
        var groupMsgId = sh.getRange(rowNum, 22).getValue();
        var appNumber = sh.getRange(rowNum, 24).getValue();
        
        // Формируем сообщение для группы
        var groupMessage = '💬 <b>Комментарий администратора</b>';
        if (appNumber) groupMessage += '\n📝 Заявка: ' + appNumber;
        groupMessage += '\n🏭 Поставщик: ' + escapeHtml_(String(supplier || ''));
        groupMessage += '\n\n💭 ' + escapeHtml_(text);
        
        // Отправляем в группу
        var replyTo = groupMsgId ? Number(groupMsgId) : null;
        sendTelegramMessageFastReply_(botToken, groupChatId, groupMessage, {
          replyToMessageId: replyTo
        });
        
        // Подтверждение админу
        var confirmMessage = '✅ Комментарий отправлен в группу';
        sendTelegramMessageFastReply_(botToken, adminChatId, confirmMessage);
        
        // Удаляем сессию
        cache.remove(key);
        
        // Логируем
        logEvent_('admin_comment', 'sent', {
          rowNum: rowNum,
          comment: text
        });
        
        return;
      }
    }
    
    logEvent_('handleAdminCommentMessage', 'no_session_found', {
      text: text
    });
    
  } catch (error) {
    logEvent_('handleAdminCommentMessage', 'critical_error', {
      error: String(error),
      stack: error.stack ? error.stack : 'no_stack'
    });
    
    logFunctionWarn_('handleAdminCommentMessage_', 'Error', {
      error: String(error)
    });
  }
}

// Функция для обработки редактирования полей и отмены
function handleEditFieldMessage_(message, botToken, adminChatId, groupChatId) {
  var chatId = message && message.chat ? String(message.chat.id) : '';
  if (chatId !== String(groupChatId)) return;
  
  var text = message && message.text ? String(message.text).trim() : '';
  if (!text) return;
  
  try {
    var cache = CacheService.getScriptCache();
    
    // Ищем активную сессию редактирования (без использования getCacheKeys_)
    // Проверяем возможные ключи от 1 до 1000
    for (var i = 1; i <= 1000; i++) {
      var key = 'edit_field_' + i;
      var field = cache.get(key); // Получаем значение из кэша
      if (field) {
        var rowNum = i;
        
        logEvent_('handleEditFieldMessage', 'found_session', {
          key: key,
          rowNum: rowNum,
          field: field
        });
        
        // Получаем номер заявки для проверки формата
        var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
        if (!sh) continue;
        
        var appNumber = sh.getRange(rowNum, 24).getValue();
        if (!appNumber) continue;
        
        // ПРОВЕРКА ФОРМАТА: должно начинаться с номера заявки
        var expectedPrefix = (appNumber.toString()).toLowerCase();
        if (!text.toLowerCase().startsWith(expectedPrefix)) {
          // Неверный формат - игнорируем сообщение
          logEvent_('handleEditFieldMessage', 'wrong_format', {
            expectedPrefix: expectedPrefix,
            text: text
          });
          return;
        }
        
        // Извлекаем только данные после номера заявки
        var dataValue = text.substring(expectedPrefix.length).trim();
        if (!dataValue) return; // Пустые данные игнорируем
        
        var columnIndex = 0;
        var fieldTitle = '';
        var updateSuccessful = false;
        
        // Определяем колонку для обновления
        switch (field) {
          case 'supplier':
            columnIndex = 3;  // Колонка C
            fieldTitle = '🏭 Поставщик';
            sh.getRange(rowNum, columnIndex).setValue(dataValue);
            updateSuccessful = true;
            break;
          case 'product_type':
            columnIndex = 5;  // Колонка E
            fieldTitle = '🏷️ Тип товара';
            sh.getRange(rowNum, columnIndex).setValue(dataValue);
            updateSuccessful = true;
            break;
          case 'lk':
            columnIndex = 6;  // Колонка F
            fieldTitle = '🧾 ЛК';
            sh.getRange(rowNum, columnIndex).setValue(dataValue);
            updateSuccessful = true;
            break;
          case 'dimensions':
            // Обработка габаритов (формат: Д×Ш×В в сантиметрах)
            var parts = dataValue.split(/[x×х*]/);
            if (parts.length === 3) {
              // Преобразуем сантиметры в метры
              var lengthM = (Number(parts[0]) || 0) / 100;
              var widthM = (Number(parts[1]) || 0) / 100;
              var heightM = (Number(parts[2]) || 0) / 100;
              
              sh.getRange(rowNum, 7).setValue(lengthM);  // Колонка G
              sh.getRange(rowNum, 8).setValue(widthM);   // Колонка H
              sh.getRange(rowNum, 9).setValue(heightM);  // Колонка I
              fieldTitle = '📏 Габариты';
              
              // Формируем значение для отображения
              dataValue = lengthM + '×' + widthM + '×' + heightM;
              updateSuccessful = true;
            } else {
              sendTelegramMessageFastReply_(botToken, groupChatId, 
                '❌ Неверный формат габаритов. Используйте: ' + appNumber + ' 15×14×16 (в сантиметрах)');
              cache.remove(key); // Удаляем сессию даже при ошибке
              return;
            }
            break;
          case 'weight':
            columnIndex = 17;  // Колонка Q
            fieldTitle = '⚖️ Вес';
            sh.getRange(rowNum, columnIndex).setValue(Number(dataValue) || 0);
            updateSuccessful = true;
            break;
          case 'tpr2':
            columnIndex = 10;  // Колонка J
            fieldTitle = '🧊 ТПР2';
            sh.getRange(rowNum, columnIndex).setValue(Number(dataValue) || 0);
            updateSuccessful = true;
            break;
          case 'tpr3':
            columnIndex = 11;  // Колонка K
            fieldTitle = '📦 ТПР3';
            sh.getRange(rowNum, columnIndex).setValue(Number(dataValue) || 0);
            updateSuccessful = true;
            break;
          case 'tpr4':
            columnIndex = 12;  // Колонка L
            fieldTitle = '🪵 ТПР4';
            sh.getRange(rowNum, columnIndex).setValue(Number(dataValue) || 0);
            updateSuccessful = true;
            break;
          case 'comment':
            columnIndex = 20;  // Колонка T
            fieldTitle = '💬 Комментарий';
            sh.getRange(rowNum, columnIndex).setValue(dataValue);
            updateSuccessful = true;
            break;
          default:
            continue;
        }
        
        if (updateSuccessful) {
          // Подтверждение
          var confirmMessage = '✅ ' + fieldTitle + ' обновлено';
          confirmMessage += '\n\nНовое значение: <b>' + escapeHtml_(dataValue) + '</b>';
          sendTelegramMessageFastReply_(botToken, groupChatId, confirmMessage);
          
          // Обновляем главное сообщение с данными заявки
          updateMainMessageAfterEdit_(botToken, groupChatId, rowNum);
          
          // Удаляем сессию
          cache.remove(key);
          
          // Логируем
          logEvent_('field_edit', 'updated', {
            rowNum: rowNum,
            field: field,
            newValue: dataValue
          });
        }
        
        return;
      }
    }
    
    logEvent_('handleEditFieldMessage', 'no_session_found', {
      text: text
    });
    
  } catch (error) {
    logEvent_('handleEditFieldMessage', 'critical_error', {
      error: String(error),
      stack: error.stack ? error.stack : 'no_stack'
    });
    
    logFunctionWarn_('handleEditFieldMessage_', 'Error', {
      error: String(error)
    });
  }
}

// Функция для получения кнопок быстрого выбора заявок
function getQuickSelectButtons_() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return [];
    
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + 
                  String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(today.getDate()).padStart(2, '0');
    
    var lastRow = sh.getLastRow();
    var pendingApps = [];
    
    // Ищем незавершенные заявки текущего дня
    for (var i = 2; i <= lastRow; i++) {
      var timestamp = sh.getRange(i, 1).getValue();
      var status = sh.getRange(i, 21).getValue();
      var appNumber = sh.getRange(i, 24).getValue();
      var supplier = sh.getRange(i, 3).getValue();
      
      if (timestamp && status !== 'DONE') {
        var date = new Date(timestamp);
        var dateStr = date.getFullYear() + '-' + 
                     String(date.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(date.getDate()).padStart(2, '0');
        
        if (dateStr === todayStr && appNumber) {
          pendingApps.push({
            rowNum: i,
            appNumber: appNumber,
            supplier: supplier || 'Без поставщика'
          });
        }
      }
    }
    
    if (pendingApps.length === 0) return [];
    
    // Создаем кнопки (максимум 5 заявок)
    var buttons = [];
    var maxApps = Math.min(pendingApps.length, 5);
    
    for (var j = 0; j < maxApps; j++) {
      var app = pendingApps[j];
      var buttonText = app.appNumber + ' - ' + escapeHtml_(app.supplier);
      
      // Обрезаем длинные названия
      if (buttonText.length > 40) {
        buttonText = buttonText.substring(0, 37) + '...';
      }
      
      buttons.push([{
        text: buttonText,
        callback_data: 'quick_select:' + app.rowNum + ':' + app.appNumber
      }]);
    }
    
    return buttons;
    
  } catch (error) {
    logFunctionWarn_('getQuickSelectButtons_', 'Error', {
      error: String(error)
    });
    return [];
  }
}

// Функция для обработки быстрого выбора заявки
function handleQuickSelect_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  var m = data.match(/^quick_select:(\d+):(.+)$/);
  if (!m) return;
  
  var rowNum = parseInt(m[1], 10);
  var appNumber = m[2];
  if (!rowNum || rowNum < 2 || !appNumber) return;
  
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    var groupMsgId = sh.getRange(rowNum, 22).getValue();
    if (!groupMsgId) {
      sendTelegramMessage_(botToken, callback.message.chat.id, 
        '❌ У заявки нет сообщения в группе для редактирования.');
      return;
    }
    
    // Открываем меню редактирования для выбранной заявки
    sendEditDataForm_(botToken, groupChatId, rowNum, groupMsgId);
    
  } catch (error) {
    logFunctionWarn_('handleQuickSelect_', 'Error', {
      error: String(error),
      rowNum: rowNum,
      appNumber: appNumber
    });
  }
} // ДОБАВЛЕНА ЗАКРЫВАЮЩАЯ СКОБКА

// Функция для показа незавершенных заявок текущего дня с Reply-кнопками
function showPendingApplications_(botToken, chatId) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + 
                  String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(today.getDate()).padStart(2, '0');
    
    var lastRow = sh.getLastRow();
    var pendingApps = [];
    
    // Ищем незавершенные заявки текущего дня
    for (var i = 2; i <= lastRow; i++) {
      var timestamp = sh.getRange(i, 1).getValue();
      var status = sh.getRange(i, 21).getValue();
      var appNumber = sh.getRange(i, 24).getValue();
      var supplier = sh.getRange(i, 3).getValue();
      
      if (timestamp && status !== 'DONE') {
        var date = new Date(timestamp);
        var dateStr = date.getFullYear() + '-' + 
                     String(date.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(date.getDate()).padStart(2, '0');
        
        if (dateStr === todayStr && appNumber) {
          pendingApps.push({
            rowNum: i,
            appNumber: appNumber,
            supplier: supplier || 'Без поставщика'
          });
        }
      }
    }
    
    if (pendingApps.length === 0) {
      sendTelegramMessage_(botToken, chatId, '📋 <b>Незавершенные заявки</b>\n\nНа сегодня нет незавершенных заявок.');
      return;
    }
    
    // Формируем сообщение со списком заявок
    var message = '📋 <b>Незавершенные заявки на сегодня</b>\n\n';
    var keyboard = [];
    
    for (var j = 0; j < pendingApps.length; j++) {
      var app = pendingApps[j];
      message += '📝 ' + app.appNumber + ' - ' + escapeHtml_(app.supplier) + '\n';
      
      // Добавляем кнопку для каждой заявки
      keyboard.push([{
        text: app.appNumber + ' - ' + app.supplier,
        callback_data: 'select_app:' + app.rowNum
      }]);
    }
    
    message += '\nВыберите заявку для редактирования:';
    
    var replyMarkup = {
      inline_keyboard: keyboard
    };
    
    sendTelegramMessage_(botToken, chatId, message, {
      replyMarkup: replyMarkup
    });
    
  } catch (error) {
    logFunctionWarn_('showPendingApplications_', 'Error', {
      error: String(error)
    });
  }
}

// Функция для обработки выбора заявки
function handleSelectApplication_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  var m = data.match(/^select_app:(\d+)$/);
  if (!m) return;
  
  var rowNum = parseInt(m[1], 10);
  if (!rowNum || rowNum < 2) return;
  
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    var groupMsgId = sh.getRange(rowNum, 22).getValue();
    if (!groupMsgId) {
      sendTelegramMessage_(botToken, callback.message.chat.id, 
        '❌ У заявки нет сообщения в группе для редактирования.');
      return;
    }
    
    // Открываем меню редактирования для выбранной заявки
    sendEditDataForm_(botToken, groupChatId, rowNum, groupMsgId);
    
  } catch (error) {
    logFunctionWarn_('handleSelectApplication_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// Функция для очистки сессий через callback
// Функция для очистки сессий через callback
function handleClearSessions_(callback, botToken, adminChatId, groupChatId) {
  try {
    // Очищаем все сессии редактирования (без использования getCacheKeys_)
    var cache = CacheService.getScriptCache();
    var cleared = 0;
    
    // Очищаем по паттерну от 1 до 1000
    for (var i = 1; i <= 1000; i++) {
      var editKey = 'edit_field_' + i;
      var commentKey = 'await_comment_' + i;
      
      if (cache.get(editKey)) {
        cache.remove(editKey);
        cleared++;
      }
      
      if (cache.get(commentKey)) {
        cache.remove(commentKey);
        cleared++;
      }
    }
    
    // Отправляем подтверждение
    var responseText = '✅ <b>Очистка сессий</b>\n\n';
    responseText += '🧹 Очищено зависших сессий: ' + cleared;
    if (cleared === 0) {
      responseText += '\n\nℹ️ Активных сессий не найдено';
    }
    
    if (callback && callback.message) {
      var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/editMessageText';
      var payload = {
        chat_id: String(callback.message.chat.id),
        message_id: String(callback.message.message_id),
        text: responseText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      
      UrlFetchApp.fetch(api, {
        method: 'post',
        muteHttpExceptions: true,
        payload: payload,
        timeout: 1000
      });
    }
    
    logEvent_('clear_sessions', 'executed', {
      cleared: cleared
    });
    
  } catch (error) {
    logFunctionWarn_('handleClearSessions_', 'Error', {
      error: String(error)
    });
  }
}
// Функция для обработки callback редактирования полей (УЛЬТРА-БЫСТРАЯ)
function handleEditFieldCallback_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  
  if (data.startsWith('edit_cancel:')) {
    handleEditCancel_(callback, botToken, adminChatId, groupChatId);
    return;
  }
  
  var m = data.match(/^edit_field:(\w+):(\d+)$/);
  if (!m) return;
  
  var field = m[1];
  var rowNum = parseInt(m[2], 10);
  
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    var appNumber = sh.getRange(rowNum, 24).getValue();
    var currentValue = '';
    var fieldTitle = '';
    
    switch (field) {
      case 'supplier':
        fieldTitle = '🏭 Поставщик';
        currentValue = String(sh.getRange(rowNum, 3).getValue() || '');
        break;
      case 'product_type':
        fieldTitle = '🏷️ Тип товара';
        currentValue = String(sh.getRange(rowNum, 5).getValue() || '');
        break;
      case 'lk':
        fieldTitle = '🧾 ЛК';
        currentValue = String(sh.getRange(rowNum, 6).getValue() || '');
        break;
      case 'dimensions':
        fieldTitle = '📏 Габариты';
        var length = sh.getRange(rowNum, 7).getValue() || 0;
        var width = sh.getRange(rowNum, 8).getValue() || 0;
        var height = sh.getRange(rowNum, 9).getValue() || 0;
        currentValue = length + '×' + width + '×' + height;
        break;
      case 'weight':
        fieldTitle = '⚖️ Вес';
        currentValue = String(sh.getRange(rowNum, 17).getValue() || '');
        break;
      case 'tpr2':
        fieldTitle = '🧊 ТПР2';
        currentValue = String(sh.getRange(rowNum, 10).getValue() || '');
        break;
      case 'tpr3':
        fieldTitle = '📦 ТПР3';
        currentValue = String(sh.getRange(rowNum, 11).getValue() || '');
        break;
      case 'tpr4':
        fieldTitle = '🪵 ТПР4';
        currentValue = String(sh.getRange(rowNum, 12).getValue() || '');
        break;
      case 'comment':
        fieldTitle = '💬 Комментарий';
        currentValue = String(sh.getRange(rowNum, 20).getValue() || '');
        break;
      default:
        return;
    }
    
    var cache = CacheService.getScriptCache();
    var cacheKey = 'edit_field_' + rowNum;
    cache.put(cacheKey, field, 300);
    
    var instructionText = '\n\n✏️ <b>Редактирование поля</b> ' + (appNumber ? appNumber : '');
    instructionText += '\n\n' + fieldTitle;
    instructionText += '\n\nТекущее значение: <b>' + escapeHtml_(currentValue || 'пусто') + '</b>';
    
    if (field === 'dimensions') {
      instructionText += '\n\n<i>Пример ввода: ' + (appNumber || 'ULN116') + ' 15×14×16</i>';
      instructionText += '\n<i>Формат: НОМЕР_ЗАЯВКИ Д×Ш×В (в сантиметрах)</i>';
      instructionText += '\n<i>Автоматически преобразуется в: 0.15×0.14×0.16 (метры)</i>';
    } else {
      instructionText += '\n\n<i>Пример ввода: ' + (appNumber || 'ULN116') + ' Новое значение</i>';
      instructionText += '\n<i>Формат: НОМЕР_ЗАЯВКИ данные</i>';
    }
    
    // Добавляем кнопки для быстрого выбора других заявок
    var quickSelectButtons = getQuickSelectButtons_();
    if (quickSelectButtons.length > 0) {
      instructionText += '\n\n🔍 <b>Быстрый выбор заявки:</b>';
    }
    
    instructionText += '\n\nИли нажмите кнопку для отмены.';
    
    var replyMarkup = {
      inline_keyboard: []
    };
    
    // Добавляем кнопки быстрого выбора заявок
    if (quickSelectButtons.length > 0) {
      replyMarkup.inline_keyboard = replyMarkup.inline_keyboard.concat(quickSelectButtons);
    }
    
    // Добавляем кнопку отмены
    replyMarkup.inline_keyboard.push([
      { text: '❌ Отмена', callback_data: 'edit_cancel:' + rowNum }
    ]);
    
    if (callback && callback.message) {
      var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/editMessageText';
      var payload = {
        chat_id: String(callback.message.chat.id),
        message_id: String(callback.message.message_id),
        text: String(callback.message.text || '') + instructionText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      
      if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
      }
      
      UrlFetchApp.fetch(api, {
        method: 'post',
        muteHttpExceptions: true,
        payload: payload,
        timeout: 1000
      });
    }
    
  } catch (error) {
    logFunctionWarn_('handleEditFieldCallback_', 'Error', {
      error: String(error),
      field: field,
      rowNum: rowNum
    });
  }
}

// Функция для обработки редактирования полей и отмены (УЛЬТРА-БЫСТРАЯ)


// Функция для обновления главного сообщения после редактирования (ОПТИМИЗИРОВАННАЯ)
function updateMainMessageAfterEdit_(botToken, groupChatId, rowNum) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    // БЫСТРОЕ получение только нужных данных
    var groupMsgId = sh.getRange(rowNum, 22).getValue();
    
    logEvent_('updateMainMessageAfterEdit', 'checking', {
      rowNum: rowNum,
      groupMsgId: groupMsgId,
      groupMsgIdType: typeof groupMsgId
    });
    
    if (!groupMsgId || groupMsgId === 'NEW' || groupMsgId === 'new') {
      logEvent_('updateMainMessageAfterEdit', 'invalid_group_msg_id', {
        rowNum: rowNum,
        groupMsgId: groupMsgId,
        reason: 'groupMsgId is empty or NEW'
      });
      return;
    }
    
    // БЫСТРОЕ формирование сообщения (без полного чтения строки)
    var rowData = sh.getRange(rowNum, 1, 1, 25).getValues()[0];
    var appNumber = rowData[24];
    
    // УЛЬТРА-БЫСТРОЕ формирование сообщения
    var updatedMessage = buildFullTelegramMessageFromRowData_(rowData, appNumber);
    
    // Добавляем кнопки обратно
    var replyMarkup = {
      inline_keyboard: [[
        { text: '✏️ Изменить данные', callback_data: 'group_edit:' + rowNum },
        { text: '📤 Отправить админу', callback_data: 'group_send_admin:' + rowNum }
      ]]
    };
    
    // УЛЬТРА-БЫСТРОЕ обновление с минимальным таймаутом
    var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/editMessageText';
    var payload = {
      chat_id: String(groupChatId),
      message_id: String(groupMsgId),
      text: String(updatedMessage || ''),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    
    if (replyMarkup) {
      payload.reply_markup = JSON.stringify(replyMarkup);
    }
    
    logEvent_('updateMainMessageAfterEdit', 'sending_api_request', {
      rowNum: rowNum,
      groupMsgId: groupMsgId,
      chatId: groupChatId
    });
    
    var response = UrlFetchApp.fetch(api, {
      method: 'post',
      muteHttpExceptions: true,
      payload: payload,
      timeout: 1500 // Только 1.5 секунды!
    });
    
    // Логируем результат API запроса
    var responseText = response.getContentText() || '';
    var responseJson = JSON.parse(responseText || '{}');
    
    logEvent_('updateMainMessageAfterEdit', 'api_response', {
      rowNum: rowNum,
      ok: responseJson.ok,
      description: responseJson.description || '',
      responseCode: response.getResponseCode || ''
    });
    
    if (!responseJson.ok) {
      logFunctionWarn_('updateMainMessageAfterEdit_', 'API Error', {
        rowNum: rowNum,
        groupMsgId: groupMsgId,
        error: responseJson.description || 'Unknown API error'
      });
    }
    
  } catch (error) {
    logEvent_('updateMainMessageAfterEdit', 'exception', {
      error: String(error),
      rowNum: rowNum,
      stack: error.stack ? error.stack : 'no_stack'
    });
    
    logFunctionWarn_('updateMainMessageAfterEdit_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// Функция для отмены редактирования
function handleEditCancel_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  
  logEvent_('handleEditCancel', 'started', {
    callbackData: data,
    callbackId: callback.id,
    chatId: callback.message ? callback.message.chat.id : 'unknown'
  });
  
  var m = data.match(/^edit_cancel:(\d+)$/);
  if (!m) {
    logEvent_('handleEditCancel', 'no_match', { callbackData: data });
    return;
  }
  
  var rowNum = parseInt(m[1], 10);
  
  logEvent_('handleEditCancel', 'parsed', {
    rowNum: rowNum,
    callbackData: data
  });
  
  try {
    // Удаляем сессию
    var cache = CacheService.getScriptCache();
    var cacheKey = 'edit_field_' + rowNum;
    
    logEvent_('handleEditCancel', 'removing_cache', {
      cacheKey: cacheKey,
      rowNum: rowNum
    });
    
    cache.remove(cacheKey);
    
    // Получаем ID сообщения в группе
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) {
      logEvent_('handleEditCancel', 'no_sheet', { rowNum: rowNum });
      return;
    }
    
    var groupMsgId = sh.getRange(rowNum, 22).getValue();
    if (!groupMsgId) {
      logEvent_('handleEditCancel', 'no_group_msg_id', { rowNum: rowNum });
      return;
    }
    
    logEvent_('handleEditCancel', 'updating_message', {
      rowNum: rowNum,
      groupMsgId: groupMsgId
    });
    
    // Возвращаемся к главному сообщению с кнопками
    updateMainMessageAfterEdit_(botToken, groupChatId, rowNum);
    
    logEvent_('handleEditCancel', 'completed', {
      rowNum: rowNum,
      success: true
    });
    
  } catch (error) {
    logEvent_('handleEditCancel', 'error', {
      error: String(error),
      rowNum: rowNum,
      stack: error.stack ? error.stack : 'no_stack'
    });
    
    logFunctionWarn_('handleEditCancel_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// Функция для отмены комментария админа
function handleAdminCommentCancel_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  var m = data.match(/^admin_comment_cancel:(\d+)$/);
  if (!m) return;
  
  var rowNum = parseInt(m[1], 10);
  
  try {
    // Удаляем сессию
    var cache = CacheService.getScriptCache();
    var cacheKey = 'await_comment_' + rowNum;
    cache.remove(cacheKey);
    
    // Обновляем сообщение админа
    if (callback && callback.message) {
      var message = '❌ <b>Добавление комментария отменено</b>';
      editMessageWithKeyboardNow_(botToken, callback.message.chat.id, 
        Number(callback.message.message_id), message, null);
    }
    
  } catch (error) {
    logFunctionWarn_('handleAdminCommentCancel_', 'Error', {
      error: String(error),
      rowNum: rowNum
    });
  }
}

// Функция для проверки конфигурации
function checkConfig() {
  var cfg = getConfig_();
  
  logEvent_('checkConfig', 'config_test', {
    BOT_TOKEN: cfg.BOT_TOKEN ? '✅ Установлен (' + cfg.BOT_TOKEN.substring(0, 10) + '...)' : '❌ Не установлен',
    ADMIN_CHAT_ID: cfg.ADMIN_CHAT_ID ? '✅ Установлен: ' + cfg.ADMIN_CHAT_ID : '❌ Не установлен',
    GROUP_CHAT_ID: cfg.GROUP_CHAT_ID ? '✅ Установлен: ' + cfg.GROUP_CHAT_ID : '❌ Не установлен',
    SPREADSHEET_ID: cfg.SPREADSHEET_ID ? '✅ Установлен' : '❌ Не установлен'
  });
  
  // Проверяем доступ к таблице
  try {
    var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    var sheets = ss.getSheets();
    var sheetNames = sheets.map(function(s) { return s.getName(); });
    
    logEvent_('checkConfig', 'spreadsheet_check', {
      sheetsCount: sheets.length,
      sheetNames: sheetNames.join(', ')
    });
    
    return '✅ Конфигурация проверена. Листов в таблице: ' + sheets.length;
  } catch (error) {
    logEvent_('checkConfig', 'spreadsheet_error', {
      error: String(error)
    });
    return '❌ Ошибка доступа к таблице: ' + error;
  }
}

// Функция для тестирования получения сообщений
function testMessageHandling() {
  var cfg = getConfig_();
  
  logEvent_('testMessageHandling', 'test_started', {
    botTokenExists: Boolean(cfg.BOT_TOKEN),
    adminChatId: cfg.ADMIN_CHAT_ID,
    groupChatId: cfg.GROUP_CHAT_ID
  });
  
  // Создаем тестовое сообщение
  var testMessage = {
    message_id: Math.floor(Math.random() * 1000000),
    from: {
      id: 123456789,
      first_name: 'Test',
      username: 'testuser'
    },
    chat: {
      id: cfg.GROUP_CHAT_ID || cfg.ADMIN_CHAT_ID || 'test_chat_id',
      type: 'group'
    },
    text: '/test',
    date: Math.floor(Date.now() / 1000)
  };
  
  try {
    handleMessage_(testMessage);
    return '✅ Тестовое сообщение обработано';
  } catch (error) {
    logEvent_('testMessageHandling', 'test_error', {
      error: String(error)
    });
    return '❌ Ошибка обработки: ' + error;
  }
}

// Функция для очистки всех логов и кэша
function resetDebug() {
  var cache = CacheService.getScriptCache();
  
  // Очищаем весь кэш
  for (var i = 1; i <= 2000; i++) {
    cache.remove('edit_field_' + i);
    cache.remove('await_comment_' + i);
    cache.remove('cb_' + i);
    cache.remove('msg_' + i);
  }
  
  logEvent_('resetDebug', 'cache_cleared', {
    timestamp: new Date().toISOString()
  });
  
  return '✅ Кэш очищен. Теперь можно тестировать.';
}

function checkProps() {
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  var adminChatId = props.getProperty('ADMIN_CHAT_ID');
  var groupChatId = props.getProperty('GROUP_CHAT_ID');
  
  console.log('🔑 Script Properties:');
  console.log('- BOT_TOKEN exists:', Boolean(botToken));
  console.log('- ADMIN_CHAT_ID:', adminChatId);
  console.log('- GROUP_CHAT_ID:', groupChatId);
  
  return {
    botToken: botToken ? '✅ Установлен' : '❌ Нет',
    adminChatId: adminChatId || '❌ Нет',
    groupChatId: groupChatId || '❌ Нет'
  };
}

function setWebhook() {
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  
  if (!botToken) {
    console.error('❌ Нет токена бота');
    return '❌ Нет токена бота';
  }
  
  // Получите URL деплоямента вашего скрипта
  // Идем в Deploy -> Manage deployments -> Получить URL
  var webhookUrl = 'https://script.google.com/macros/s/AKfycbwR70njJu1aRLypsx1T3FtRHPvRw68da6Hw2U2ZwYxMsRKkuRPCIIJyyeTNAHFUhYgt1A/exec';
  
  console.log('🌐 Setting webhook to:', webhookUrl);
  
  var apiUrl = 'https://api.telegram.org/bot' + botToken + '/setWebhook';
  
  var payload = {
    url: webhookUrl,
    drop_pending_updates: true  // ОЧЕНЬ ВАЖНО: сбросить pending updates
  };
  
  var options = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(apiUrl, options);
    var result = JSON.parse(response.getContentText());
    
    console.log('✅ Webhook result:', result);
    
    if (result.ok) {
      return '✅ Вебхук установлен! Pending updates сброшены.';
    } else {
      return '❌ Ошибка: ' + result.description;
    }
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return '❌ Ошибка: ' + error.message;
  }
}

function checkExecutionLogs() {
  console.log('🔍 Проверка логов выполнения...');
  
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  var adminChatId = props.getProperty('ADMIN_CHAT_ID');
  var groupChatId = props.getProperty('GROUP_CHAT_ID');
  
  console.log('🔧 Конфигурация:');
  console.log('- botToken:', botToken ? '✅ Есть (' + botToken.substring(0, 10) + '...)' : '❌ Нет');
  console.log('- adminChatId:', adminChatId);
  console.log('- groupChatId:', groupChatId);
  
  return '✅ Логи проверены, смотрите View → Logs';
}

function testTelegram() {
  var props = PropertiesService.getScriptProperties();
  var botToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  var adminChatId = props.getProperty('ADMIN_CHAT_ID');
  
  if (!botToken || !adminChatId) {
    return '❌ Не хватает конфигурации';
  }
  
  var message = '🤖 Бот работает! ' + new Date().toLocaleString();
  
  var result = sendTelegramMessage_(botToken, adminChatId, message);
  
  return result ? '✅ Сообщение отправлено: ' + result : '❌ Ошибка отправки';
}

// Функция для обработки кнопки "Мои заявки" админа
function handleAdminMyApps_(callback, botToken, adminChatId, groupChatId) {
  try {
    logEvent_('handleAdminMyApps', 'started', {
      callbackId: callback.id,
      chatId: callback.message ? callback.message.chat.id : 'unknown'
    });
    
    // Показываем незавершенные заявки для админа
    showPendingApplications_(botToken, callback.message.chat.id);
    
    logEvent_('handleAdminMyApps', 'completed', {
      chatId: callback.message ? callback.message.chat.id : 'unknown'
    });
    
  } catch (error) {
    logEvent_('handleAdminMyApps', 'error', {
      error: String(error),
      callbackId: callback.id
    });
    
    // Отправляем сообщение об ошибке
    if (callback && callback.message) {
      sendTelegramMessage_(botToken, callback.message.chat.id, 
        '❌ Ошибка при загрузке заявок. Попробуйте еще раз.');
    }
  }
}

// Функция для обработки кнопки "Не забитые ВГХ" пользователя
function handleUserMyApps_(callback, botToken, adminChatId, groupChatId) {
  try {
    logEvent_('handleUserMyApps', 'started', {
      callbackId: callback.id,
      chatId: callback.message ? callback.message.chat.id : 'unknown'
    });
    
    // Показываем заявки пользователя (аналогично админу, но с другим текстом)
    showUserApplications_(botToken, callback.message.chat.id);
    
    logEvent_('handleUserMyApps', 'completed', {
      chatId: callback.message ? callback.message.chat.id : 'unknown'
    });
    
  } catch (error) {
    logEvent_('handleUserMyApps', 'error', {
      error: String(error),
      callbackId: callback.id
    });
    
    // Отправляем сообщение об ошибке
    if (callback && callback.message) {
      sendTelegramMessage_(botToken, callback.message.chat.id, 
        '❌ Ошибка при загрузке заявок. Попробуйте еще раз.');
    }
  }
}

// Функция для показа заявок пользователя (аналог showPendingApplications_ но для обычных пользователей)
function showUserApplications_(botToken, chatId) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + 
                  String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(today.getDate()).padStart(2, '0');
    
    var lastRow = sh.getLastRow();
    var pendingApps = [];
    
    // Ищем незавершенные заявки текущего дня
    for (var i = 2; i <= lastRow; i++) {
      var timestamp = sh.getRange(i, 1).getValue();
      var status = sh.getRange(i, 21).getValue();
      var appNumber = sh.getRange(i, 24).getValue();
      var supplier = sh.getRange(i, 3).getValue();
      
      if (timestamp && status !== 'DONE') {
        var date = new Date(timestamp);
        var dateStr = date.getFullYear() + '-' + 
                     String(date.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(date.getDate()).padStart(2, '0');
        
        if (dateStr === todayStr && appNumber) {
          pendingApps.push({
            rowNum: i,
            appNumber: appNumber,
            supplier: supplier || 'Без поставщика'
          });
        }
      }
    }
    
    if (pendingApps.length === 0) {
      var userMessage = '📋 <b>Ваши заявки на ВГХ</b>\n\n';
      userMessage += '✅ На сегодня нет активных заявок.\n\n';
      userMessage += '📝 Новые заявки можно создавать в общей группе приемки.';
      
      sendTelegramMessage_(botToken, chatId, userMessage);
      return;
    }
    
    // Формируем сообщение со списком заявок для пользователя
    var userMessage = '📋 <b>Ваши заявки на ВГХ</b>\n\n';
    userMessage += '🔍 <b>Активные заявки на сегодня:</b>\n\n';
    
    var keyboard = [];
    
    for (var j = 0; j < pendingApps.length; j++) {
      var app = pendingApps[j];
      userMessage += '📝 ' + app.appNumber + ' - ' + escapeHtml_(app.supplier) + '\n';
      
      // Добавляем кнопку для каждой заявки (но с другим текстом для пользователя)
      keyboard.push([{
        text: '📄 Детали: ' + app.appNumber,
        callback_data: 'user_view_app:' + app.rowNum
      }]);
    }
    
    userMessage += '\n💡 Нажмите на заявку для просмотра деталей.';
    
    var replyMarkup = {
      inline_keyboard: keyboard
    };
    
    sendTelegramMessage_(botToken, chatId, userMessage, {
      replyMarkup: replyMarkup
    });
    
    logEvent_('showUserApplications', 'apps_shown', {
      chatId: chatId,
      appsCount: pendingApps.length
    });
    
  } catch (error) {
    logFunctionWarn_('showUserApplications_', 'Error', {
      error: String(error),
      chatId: chatId
    });
  }
}

// Функция для обработки просмотра деталей заявки пользователем
function handleUserViewApp_(callback, botToken, adminChatId, groupChatId) {
  var data = String(callback && callback.data ? callback.data : '');
  var m = data.match(/^user_view_app:(\d+)$/);
  if (!m) return;
  
  var rowNum = parseInt(m[1], 10);
  if (!rowNum || rowNum < 2) return;
  
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (!sh) return;
    
    // Получаем данные заявки
    var rowData = sh.getRange(rowNum, 1, 1, 25).getValues()[0];
    var appNumber = rowData[24];
    
    if (!appNumber) {
      sendTelegramMessage_(botToken, callback.message.chat.id, 
        '❌ Заявка не найдена или не имеет номера.');
      return;
    }
    
    // Формируем сообщение с деталями заявки для пользователя
    var userDetailMessage = '📄 <b>Детали заявки ' + appNumber + '</b>\n\n';
    userDetailMessage += buildFullTelegramMessageFromRowData_(rowData, appNumber);
    
    // Добавляем статус заявки
    var status = rowData[20] || 'Не указан';
    var statusText = '';
    
    if (status === 'DONE') {
      statusText = '✅ <b>Выполнено</b>';
    } else if (status === 'REWORK') {
      statusText = '↩️ <b>На доработке</b>';
    } else if (status === 'NEW') {
      statusText = '🆕 <b>Новая</b>';
    } else {
      statusText = '⏳ <b>В обработке</b>';
    }
    
    userDetailMessage += '\n\n📊 <b>Статус:</b> ' + statusText;
    userDetailMessage += '\n\n💡 <b>Информация:</b> Для изменений свяжитесь с администратором.';
    
    // Кнопка "Назад к списку"
    var replyMarkup = {
      inline_keyboard: [[
        { text: '🔙 Назад к списку', callback_data: 'user_my_apps' }
      ]]
    };
    
    sendTelegramMessage_(botToken, callback.message.chat.id, userDetailMessage, {
      replyMarkup: replyMarkup
    });
    
    logEvent_('handleUserViewApp', 'details_shown', {
      rowNum: rowNum,
      appNumber: appNumber,
      chatId: callback.message.chat.id
    });
    
  } catch (error) {
    logEvent_('handleUserViewApp', 'error', {
      error: String(error),
      rowNum: rowNum
    });
    
    sendTelegramMessage_(botToken, callback.message.chat.id, 
      '❌ Ошибка при загрузке деталей заявки. Попробуйте еще раз.');
  }
}

// Функция для отправки сообщения с фото в группу
function sendTelegramMessageWithPhotos_(botToken, chatId, text, uploadedFiles, opts) {
  var o = opts || {};
  
  try {
    logEvent_('sendTelegramMessageWithPhotos', 'started', {
      chatId: chatId,
      textLength: text.length,
      filesCount: uploadedFiles ? uploadedFiles.length : 0
    });
    
    // Сначала отправляем текстовое сообщение
    var textMsgId = sendTelegramMessage_(botToken, chatId, text, {
      disableWebPagePreview: true,
      replyMarkup: o.replyMarkup
    });
    
    // Если есть фото и ID сообщения, отправляем фото как media group
    if (uploadedFiles && uploadedFiles.length > 0 && textMsgId) {
      logEvent_('sendTelegramMessageWithPhotos', 'sending_photos', {
        chatId: chatId,
        photosCount: uploadedFiles.length,
        replyToMessageId: textMsgId
      });
      
      // Отправляем только первые 10 фото (ограничение Telegram)
      var photosToSend = uploadedFiles.slice(0, 10);
      var media = [];
      
      for (var i = 0; i < photosToSend.length; i++) {
        var file = photosToSend[i];
        if (file.url && isImageUrl_(file.name)) {
          // Пробуем получить fileId из Google Drive URL
          var fileId = '';
          if (file.url && file.url.indexOf('/file/d/') !== -1) {
            var match = file.url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
              fileId = match[1];
            }
          }
          
          // Используем прямой URL с fileId если доступен
          var photoUrl = fileId ? 
            'https://drive.google.com/uc?export=view&id=' + fileId : 
            file.url;
            
          media.push({
            type: 'photo',
            media: photoUrl
          });
        }
      }
      
      // Если есть медиа файлы, отправляем media group
      if (media.length > 0) {
        var api = 'https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/sendMediaGroup';
        var payload = {
          chat_id: String(chatId),
          media: JSON.stringify(media),
          reply_to_message_id: textMsgId
        };
        
        var response = UrlFetchApp.fetch(api, {
          method: 'post',
          muteHttpExceptions: true,
          payload: payload,
          timeout: 10000 // 10 секунд для отправки медиа
        });
        
        var result = JSON.parse(response.getContentText());
        if (!result.ok) {
          logFunctionWarn_('sendTelegramMessageWithPhotos_', 'Media group error', {
            chatId: chatId,
            error: result.description || 'Unknown media group error'
          });
        }
      }
    }
    
    logEvent_('sendTelegramMessageWithPhotos', 'completed', {
      chatId: chatId,
      textMsgId: textMsgId,
      photosSent: uploadedFiles ? uploadedFiles.length : 0
    });
    
    return textMsgId;
    
  } catch (error) {
    logFunctionWarn_('sendTelegramMessageWithPhotos_', 'Exception', {
      error: String(error),
      chatId: chatId
    });
    
    // В случае ошибки, пытаемся отправить только текст
    return sendTelegramMessage_(botToken, chatId, text, {
      disableWebPagePreview: true,
      replyMarkup: o.replyMarkup
    });
  }
}

// Вспомогательная функция для проверки является ли файл изображением
function isImageUrl_(fileName) {
  if (!fileName) return false;
  
  var imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
  var extension = fileName.toLowerCase().split('.').pop();
  
  return imageExtensions.indexOf(extension) !== -1;
}

// Простая тестовая функция для проверки
function testSimple() {
  console.log('🧪 Запуск простого теста...');
  
  try {
    // Проверяем базовые функции
    var config = getConfig_();
    console.log('✅ Конфигурация загружена');
    console.log('📊 BOT_TOKEN:', config.BOT_TOKEN ? 'Есть' : 'Нет');
    console.log('📊 ADMIN_CHAT_ID:', config.ADMIN_CHAT_ID || 'Нет');
    console.log('📊 GROUP_CHAT_ID:', config.GROUP_CHAT_ID || 'Нет');
    
    // Проверяем таблицу
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_MAIN);
    if (sh) {
      console.log('✅ Таблица доступна, строк:', sh.getLastRow());
    } else {
      console.log('❌ Таблица не найдена');
    }
    
    console.log('🎉 Базовый тест пройден!');
    return 'Базовый тест завершен успешно';
    
  } catch (error) {
    console.error('❌ Ошибка в тесте:', error);
    return 'Ошибка: ' + String(error);
  }
}

// Тестовая функция для проверки обработки заявок с сайта
function testSiteSubmit() {
  console.log('🧪 Тестирование обработки заявки с сайта...');
  
  // Создаем тестовые данные как с сайта (без фото для простоты)
  var testData = {
    requestId: 'test_' + Date.now(),
    supplier: 'ООО Тестовый Поставщик',
    productName: 'Тестовый товар для ВГХ',
    productType: 'fresh',
    lk: 'LK123456',
    d_m: 2.5,
    w_m: 1.8,
    h_m: 1.2,
    weightKg: 150,
    tpr2: 10,
    tpr3: 5,
    tpr4: 2,
    sgDays: 30,
    sgPercent: 85,
    mfgDate: '2024-12-01',
    expiryDate: '2025-01-15',
    problem: 'wrong_tpr',
    comment: 'Тестовый комментарий для проверки работы бота',
    files: [] // Пока без файлов, чтобы проверить базовую логику
  };
  
  try {
    console.log('📋 Отправка тестовой заявки...');
    var result = handleSiteSubmit_(testData);
    
    console.log('✅ Результат обработки:');
    console.log(JSON.stringify(result, null, 2));
    
    // Проверяем результат
    if (result && typeof result === 'object') {
      if (result.ok) {
        console.log('🎉 Заявка успешно обработана!');
        
        // Проверяем наличие номера заявки
        if (result.deduped) {
          console.log('ℹ️ Заявка была дубликатом (deduped: true)');
        } else {
          console.log('🆕 Новая заявка создана');
        }
      } else {
        console.log('❌ Ошибка в результате:', result);
      }
    } else {
      console.log('❌ Некорректный результат:', result);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error);
    console.error('Stack:', error.stack);
  }
  
  console.log('🏁 Тестирование завершено');
  return 'Проверьте логи для детальной информации';
}

// Тестовая функция с файлами (отдельно)
function testSiteSubmitWithFiles() {
  console.log('🧪 Тестирование обработки заявки с файлами...');
  
  // Создаем простое тестовое изображение (1x1 пиксель PNG)
  var simplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  
  var testData = {
    requestId: 'test_files_' + Date.now(),
    supplier: 'ООО Тестовый Поставщик с файлами',
    productName: 'Тестовый товар с фото',
    productType: 'fresh',
    lk: 'LK789012',
    d_m: 1.5,
    w_m: 1.0,
    h_m: 0.8,
    weightKg: 75,
    tpr2: 5,
    tpr3: 3,
    tpr4: 1,
    sgDays: 15,
    sgPercent: 90,
    mfgDate: '2024-11-15',
    expiryDate: '2024-12-31',
    problem: 'wrong_tpr',
    comment: 'Тест с файлами для проверки загрузки',
    files: [
      {
        name: 'test_image.png',
        mimeType: 'image/png',
        dataBase64: simplePngBase64
      }
    ]
  };
  
  try {
    console.log('📋 Отправка тестовой заявки с файлами...');
    var result = handleSiteSubmit_(testData);
    
    console.log('✅ Результат обработки:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result && result.ok) {
      console.log('🎉 Заявка с файлами успешно обработана!');
    } else {
      console.log('❌ Ошибка в результате:', result);
    }
    
  } catch (error) {
    logPWA_('', 'getAdminData_error', null, String(error), error.stack);
    return {success: false, error: 'Ошибка загрузки данных: ' + String(error)};
  }
}

function updateRequestStatus_(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var {requestId, status, comment} = data;
    
    if (!requestId || !status) {
      return {success: false, error: 'ID заявки и статус обязательны'};
    }
    
    var cfg = getConfig_();
    var ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    var mainSheet = ss.getSheetByName(cfg.SHEET_MAIN);
    
    if (!mainSheet) {
      return {success: false, error: 'Основной лист не найден'};
    }
    
    var lastRow = mainSheet.getLastRow();
    var range = mainSheet.getRange(2, 1, lastRow - 1, mainSheet.getLastColumn());
    var data = range.getValues();
    
    var headers = mainSheet.getRange(1, 1, 1, mainSheet.getLastColumn()).getValues()[0];
    var statusCol = headers.indexOf('Статус') + 1;
    var requestIdCol = headers.indexOf('requestId') + 1;
    
    for (var i = 0; i < data.length; i++) {
      if (data[i][requestIdCol - 1] === requestId) {
        mainSheet.getRange(i + 2, statusCol).setValue(status);
        
        if (comment) {
          var commentCol = headers.indexOf('Комментарий') + 1;
          var currentComment = data[i][commentCol - 1] || '';
          mainSheet.getRange(i + 2, commentCol).setValue(currentComment + '\n\nАдмин: ' + comment);
        }
        
        logPWA_(requestId, 'updateStatus', {status: status}, null, {comment});
        
        return {success: true};
      }
    }
    
    return {success: false, error: 'Заявка не найдена'};
    
  } catch (error) {
    logPWA_(requestId, 'updateStatus_error', null, String(error), error.stack);
    return {success: false, error: 'Ошибка обновления статуса: ' + String(error)};
  }
}

// ... (pre-existing code remains the same)