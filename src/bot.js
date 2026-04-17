// Jarvis Bootstrap — Telegram бот с поддержкой Claude / Codex / Gemini
import { Bot, InputFile } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { getSession, killSession, getEngineInfo } from './engine.js';
import { downloadFile, transcribeVoice, parseMediaMarkers, sendMedia } from './media.js';
import { processResponse, detectSensitiveInput } from './hooks.js';
import { getTrustLevel, getTrustName, getTrustState, recordSession } from './trust.js';
import { startScheduler } from './scheduler.js';
import {
  getTodayCost, getCostHistory, getDailyLimit, getPermissionMode,
  getTimezone, isCostPaused, unpauseCost,
} from './state.js';
import {
  isOnboarded, getOnboardingState, setOnboardingState, clearOnboardingState,
  getWelcomeMessage, getGreetingAfterName, getReturningMessage,
  setOwnerName, completeOnboarding, getAgentName,
} from './onboarding.js';
import {
  buildSettingsKeyboard, getSettingsText, handleSettingsCallback,
  getWaitingInput, setWaitingInput, clearWaitingInput, handleSettingsInput,
  buildEnvVarsMessage,
} from './settings.js';
import { buildMainMenuKeyboard, getMainMenuText, getReturningMenuText } from './menu.js';
import { buildProjectsKeyboard, getProjectsText, handleProjectsCallback } from './projects.js';

const bot = new Bot(config.botToken);
const engineInfo = getEngineInfo(config.engine);

bot.api.config.use(autoRetry());

// ── Хелперы ──

function isAdmin(ctx) {
  if (!config.adminId) return true;
  return ctx.from?.id === config.adminId;
}

async function sendLong(ctx, text, parseMode = 'HTML') {
  const chunks = splitMessage(text, config.messageMaxLen);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: parseMode });
    } catch {
      await ctx.reply(chunk);
    }
  }
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

// ── Обработка ответа (hooks → медиа-маркеры → текст) ──

async function handleResponse(ctx, response) {
  const safe = processResponse(response);
  const { cleanText, markers } = parseMediaMarkers(safe);

  for (const marker of markers) {
    await sendMedia(ctx, marker);
  }

  if (cleanText) {
    await sendLong(ctx, cleanText);
  }
}

// ── Очередь сообщений ──

const messageQueue = new Map(); // chatId → [{ ctx, promptText }]

async function processQueue(chatId) {
  const queue = messageQueue.get(chatId);
  if (!queue || queue.length === 0) return;
  const { ctx, promptText } = queue.shift();
  if (queue.length === 0) messageQueue.delete(chatId);
  await handleMessage(ctx, promptText);
}

// ── Батчинг входящих сообщений ──
// Собираем сообщения за BATCH_DELAY_MS мс, обрабатываем как один запрос

const BATCH_DELAY_MS = 500;
const messageBatches = new Map(); // chatId → { items: Promise[], timer, ctx }

function addToBatch(chatId, ctx, asyncFn) {
  let batch = messageBatches.get(chatId);
  if (!batch) {
    batch = { items: [], timer: null, ctx };
    messageBatches.set(chatId, batch);
  }
  batch.ctx = ctx;
  batch.items.push(asyncFn()); // запускаем async-работу (download, transcribe) сразу
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => flushBatch(chatId), BATCH_DELAY_MS);
}

async function flushBatch(chatId) {
  const batch = messageBatches.get(chatId);
  if (!batch) return;
  messageBatches.delete(chatId);

  const results = await Promise.allSettled(batch.items);
  const ctx = batch.ctx;
  const prompts = [];
  const transcripts = [];
  const errors = new Set();

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) {
      if (r.status === 'rejected') errors.add(r.reason.message);
      continue;
    }
    const item = r.value;
    if (item.type === 'error') { errors.add(item.message); continue; }
    if (item.type === 'voice') transcripts.push(item.transcript);
    prompts.push(item.prompt);
  }

  // Транскрипции голосовых — одним сообщением
  if (transcripts.length > 0) {
    await ctx.reply(`🎤 <i>${transcripts.join('\n')}</i>`, { parse_mode: 'HTML' });
  }

  // Ошибки — дедуплицированно, один раз
  for (const err of errors) {
    await ctx.reply(err, { parse_mode: 'HTML' });
  }

  if (prompts.length === 0) return;

  const combined = prompts.length === 1
    ? prompts[0]
    : `Пользователь отправил ${prompts.length} сообщений подряд. Обработай как один запрос:\n\n` +
      prompts.join('\n\n---\n\n');

  await handleMessage(ctx, combined);
}

// ── Основной обработчик ──

async function handleMessage(ctx, promptText) {
  if (!isAdmin(ctx)) {
    await ctx.reply('Доступ только для владельца. Настрой ADMIN_ID в .env');
    return;
  }

  if (!config.engineKey) {
    await ctx.reply(
      `Движок <b>${engineInfo.name}</b> не настроен — нет API-ключа.\n\n` +
      `Зайди в /settings → Модель и следуй инструкции.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const session = getSession(ctx.chat.id);

  // Очередь: если занят — ставим в очередь и показываем статус
  if (session.busy) {
    const queue = messageQueue.get(ctx.chat.id) || [];
    queue.push({ ctx, promptText });
    messageQueue.set(ctx.chat.id, queue);
    await ctx.reply('⏳ в очереди');
    return;
  }

  recordSession();

  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  // Прогресс-сообщение (одно, обновляемое)
  let progressMsg = null;
  let lastProgressText = '';

  session.send(promptText, {
    onProgress: async ({ event, label, elapsed }) => {
      let statusText;
      if (event === 'thinking') {
        statusText = `🤔 Мозгую... ${elapsed}с`;
      } else if (event === 'tool_use') {
        statusText = `${label} 🌚 ${elapsed}с`;
      } else return;

      // Не обновляем если текст не изменился (кроме таймера)
      const statusBase = statusText.replace(/\d+с$/, '');
      const lastBase = lastProgressText.replace(/\d+с$/, '');
      if (statusBase === lastBase && elapsed - parseInt(lastProgressText.match(/(\d+)с$/)?.[1] || 0) < 5) return;

      lastProgressText = statusText;
      try {
        if (progressMsg) {
          await ctx.api.editMessageText(ctx.chat.id, progressMsg.message_id, statusText).catch(() => {});
        } else {
          progressMsg = await ctx.reply(statusText);
        }
      } catch { /* Telegram rate limit — пропускаем */ }
    },

    onDone: async (response) => {
      clearInterval(typingInterval);
      // Удаляем прогресс-сообщение
      if (progressMsg) {
        await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
      }
      if (response?.trim()) {
        await handleResponse(ctx, response);
      } else {
        await ctx.reply('Движок вернул пустой ответ. Попробуй переформулировать или /clear для новой сессии.');
      }
      // Обрабатываем очередь
      processQueue(ctx.chat.id);
    },
    onError: async (err) => {
      clearInterval(typingInterval);
      if (progressMsg) {
        await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
      }
      await ctx.reply(`Ошибка: ${err.message.slice(0, 500)}`);
      // Обрабатываем очередь
      processQueue(ctx.chat.id);
    },
    onCostWarning: async (cost) => {
      const limit = getDailyLimit();
      const today = getTodayCost();
      await ctx.reply(
        `⚠️ <b>80% дневного лимита</b>\n\n` +
        `Потрачено: $${today.toFixed(2)} / $${limit}\n` +
        `При 100% запросы будут приостановлены.`,
        { parse_mode: 'HTML' }
      );
    },
    onCostPaused: async () => {
      const limit = getDailyLimit();
      await ctx.reply(
        `⏸ <b>Дневной лимит достигнут</b>\n\n` +
        `Лимит: $${limit}/день. Запросы приостановлены до завтра.\n` +
        `Снять паузу: /settings → Лимит расходов`,
        { parse_mode: 'HTML' }
      );
    },
  });
}

// ── Prompt-команды (делегируются в engine) ──

const PROMPT_COMMANDS = {
  newtask:  { prompt: 'Начинаем новую задачу. Спроси что нужно сделать.', description: 'Новая задача' },
  undo:     { prompt: 'Отмени последнее изменение (git). Покажи что отменил.', description: 'Отменить правку' },
  projects: { prompt: 'Покажи список проектов в ~/projects/. Для каждого — краткое описание если есть README или package.json.', description: 'Проекты' },
  sessions: { prompt: 'Покажи информацию об активных сессиях и последней активности.', description: 'Сессии' },
  connect:  { prompt: 'Настрой VS Code туннель для удалённого доступа к серверу. Используй code tunnel CLI.', description: 'VS Code туннель' },
  recovery: { prompt: 'Покажи SSH-доступ к серверу: IP, порт, пользователь. Проверь что SSH работает.', description: 'Аварийный доступ' },
  // cost — отдельная команда с реальными данными из state.js
  monitor:  { prompt: 'Проверь статус мониторинга. Прочитай ~/.iia/monitor/config.json если есть, покажи что отслеживается.', description: 'Статус мониторинга' },
  digest:   { prompt: 'Сделай дайджест — что произошло за сегодня. Проверь daily notes, git log, задачи.', description: 'Дайджест контента' },
  sources:  { prompt: 'Покажи настроенные каналы и аккаунты для мониторинга. Проверь конфиги в ~/.iia/monitor/.', description: 'Каналы и аккаунты' },
  skills:   { prompt: 'Покажи установленные навыки агента из ~/workspace/.claude/skills/. Для каждого — название и краткое описание.', description: 'Навыки агента' },
  feedback: { prompt: 'Пользователь хочет оставить отзыв или предложение. Спроси что именно, запиши в daily note.', description: 'Отзыв' },
};

// Регистрируем prompt-команды
for (const [cmd, { prompt }] of Object.entries(PROMPT_COMMANDS)) {
  bot.command(cmd, async (ctx) => {
    if (!isAdmin(ctx)) return;
    // /newtask — сначала сбрасываем сессию
    if (cmd === 'newtask') killSession(ctx.chat.id);
    await handleMessage(ctx, prompt);
  });
}

// ── Команды (с собственной логикой) ──

bot.command('start', async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply('Доступ только для владельца.');
    return;
  }

  if (isOnboarded()) {
    // Уже знакомы — меню с кнопками
    await ctx.reply(getReturningMenuText(), {
      parse_mode: 'HTML',
      reply_markup: buildMainMenuKeyboard(),
    });
  } else {
    // Первый раз — запускаем онбординг
    setOnboardingState(ctx.chat.id, 'waiting_name');
    await ctx.reply(getWelcomeMessage(), { parse_mode: 'HTML' });
  }
});

bot.command('settings', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(getSettingsText(), {
    parse_mode: 'HTML',
    reply_markup: buildSettingsKeyboard(),
  });
});

bot.command('clear', async (ctx) => {
  killSession(ctx.chat.id);
  await ctx.reply('Контекст сброшен. Новая сессия.');
});

// /reset — алиас для /clear (обратная совместимость)
bot.command('reset', async (ctx) => {
  killSession(ctx.chat.id);
  await ctx.reply('Контекст сброшен. Новая сессия.');
});

bot.command('stop', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const session = getSession(ctx.chat.id);
  if (session.busy) {
    session.kill();
    await ctx.reply('Задача остановлена.');
  } else {
    await ctx.reply('Нет активной задачи.');
  }
});

bot.command('cost', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const today = getTodayCost();
  const limit = getDailyLimit();
  const history = getCostHistory();
  const paused = isCostPaused();

  const days = Object.keys(history).sort().slice(-7);
  const historyLines = days.length > 0
    ? days.map(d => `  ${d}: $${history[d].toFixed(2)}`).join('\n')
    : '  Нет данных';

  const pct = limit > 0 ? Math.round((today / limit) * 100) : 0;
  const bar = limit > 0 ? `(${pct}% лимита)` : '(без лимита)';

  await ctx.reply(
    `<b>Расходы</b>\n\n` +
    `Сегодня: <b>$${today.toFixed(2)}</b> ${bar}\n` +
    `Лимит: $${limit}/день\n` +
    (paused ? `⏸ <b>Приостановлено</b> — лимит достигнут\n` : '') +
    `\nИстория (7 дней):\n<pre>${historyLines}</pre>`,
    { parse_mode: 'HTML' }
  );
});

bot.command('status', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const session = getSession(ctx.chat.id);
  const trust = getTrustState();
  const today = getTodayCost();
  const limit = getDailyLimit();
  const permMode = getPermissionMode();
  const permLabels = { auto: '🤖 авто', control: '☝🏽 контроль', plan: '🤓 план' };
  await ctx.reply(
    `<b>Статус системы</b>\n\n` +
    `🤖 Агент: ${getAgentName()}\n` +
    `⚙️ Движок: ${engineInfo.name}\n` +
    `📊 Сессия: ${session.busy ? 'занята' : 'свободна'}\n` +
    `🎛 Режим: ${permLabels[permMode] || permMode}\n` +
    `💰 Сегодня: $${today.toFixed(2)} / $${limit}\n` +
    `🔒 Trust: ${trust.level} — ${getTrustName()} (${trust.sessions} сессий)\n` +
    `🕐 Последняя активность: ${new Date(session.lastActivity).toLocaleTimeString()}`,
    { parse_mode: 'HTML' }
  );
});

bot.command('help', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const promptCmds = Object.entries(PROMPT_COMMANDS)
    .map(([cmd, { description }]) => `/${cmd} — ${description}`)
    .join('\n');
  await ctx.reply(
    `<b>Команды</b>\n\n` +
    `/start — Приветствие\n` +
    `/stop — Остановить задачу\n` +
    `/clear — Сбросить контекст\n` +
    `/settings — Настройки\n` +
    `/status — Статус системы\n` +
    `\n` +
    `${promptCmds}\n` +
    `\n` +
    `/help — Все команды`,
    { parse_mode: 'HTML' }
  );
});

// ── Callback-кнопки (settings) ──

bot.on('callback_query:data', async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery({ text: 'Доступ только для владельца' });
    return;
  }
  const data = ctx.callbackQuery.data;

  if (data.startsWith('settings:')) {
    await handleSettingsCallback(ctx);
    return;
  }

  if (data.startsWith('projects:')) {
    await handleProjectsCallback(ctx, handleMessage);
    return;
  }

  if (data.startsWith('menu:')) {
    await handleMenuCallback(ctx);
    return;
  }

  await ctx.answerCallbackQuery();
});

// ── Обработка кнопок главного меню ──

async function handleMenuCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  await ctx.answerCallbackQuery();

  switch (data) {
    case 'menu:new_session':
      killSession(chatId);
      await ctx.reply('Новая сессия. Пиши задачу.');
      break;

    case 'menu:projects':
      await ctx.reply(getProjectsText(), {
        parse_mode: 'HTML',
        reply_markup: buildProjectsKeyboard(),
      });
      break;

    case 'menu:sessions':
      await handleMessage(ctx, PROMPT_COMMANDS.sessions.prompt);
      break;

    case 'menu:skills':
      await handleMessage(ctx, PROMPT_COMMANDS.skills.prompt);
      break;

    case 'menu:server':
      await handleMessage(ctx, PROMPT_COMMANDS.recovery.prompt);
      break;

    case 'menu:mcp':
      await handleMessage(ctx, 'Покажи подключённые MCP-серверы. Прочитай ~/.claude.json → mcpServers и покажи список.');
      break;

    case 'menu:settings':
      await ctx.reply(getSettingsText(), {
        parse_mode: 'HTML',
        reply_markup: buildSettingsKeyboard(),
      });
      break;

    case 'menu:monitoring':
      await handleMessage(ctx, PROMPT_COMMANDS.monitor.prompt);
      break;

    case 'menu:back':
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply(getMainMenuText(), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(),
      });
      break;
  }
}

// ── Текст ──

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  if (!isAdmin(ctx)) return;

  const chatId = ctx.chat.id;

  // 1. Онбординг — ждём имя
  const obState = getOnboardingState(chatId);
  if (obState === 'waiting_name') {
    const name = text.trim();
    if (name && name.length <= 50) {
      setOwnerName(name);
      completeOnboarding();
      clearOnboardingState(chatId);
      await ctx.reply(getGreetingAfterName(name), { parse_mode: 'HTML' });
      // Показываем главное меню после онбординга
      await ctx.reply(getMainMenuText(), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(),
      });
    } else {
      await ctx.reply('Имя должно быть от 1 до 50 символов. Попробуй ещё раз:');
    }
    return;
  }

  // 2. Settings — ждём ввод (имя владельца / агента / ключ движка)
  const waiting = getWaitingInput(chatId);
  if (waiting) {
    // Если токен обёрнут в бэктик — извлечь и склеить все code entities
    let inputText = text;
    if ((waiting.field === 'engineKey' || waiting.field === 'envVarValue') && ctx.message.entities) {
      const codeEntities = ctx.message.entities.filter(e => e.type === 'code' || e.type === 'pre');
      if (codeEntities.length > 0) {
        inputText = codeEntities.map(e => text.substring(e.offset, e.offset + e.length)).join('');
        console.log(`[bot] extracted token from ${codeEntities.length} code entities: ${inputText.length} chars`);
      }
    }
    const result = handleSettingsInput(chatId, inputText);
    if (result?.success) {
      await ctx.reply(result.success, { parse_mode: 'HTML' });
      if (result.restart) {
        setTimeout(() => process.exit(0), 1500);
      }
      // После добавления переменной — показать обновлённый список
      if (result.envVarsUpdated) {
        await ctx.reply(...buildEnvVarsMessage());
      }
    } else if (result?.error) {
      await ctx.reply(result.error, { parse_mode: 'HTML' });
    }
    return;
  }

  // 3. Автодетект секретов — не отправлять в движок!
  const detected = detectSensitiveInput(text);

  if (detected) {
    // Извлечь из code entity если есть
    let tokenText = detected.value;
    if (ctx.message.entities) {
      const codeEntity = ctx.message.entities.find(e => e.type === 'code' || e.type === 'pre');
      if (codeEntity) {
        const extracted = text.substring(codeEntity.offset, codeEntity.offset + codeEntity.length).trim();
        if (extracted.length >= tokenText.length) tokenText = extracted;
      }
    }

    console.log(`[bot] detected sensitive: ${detected.name}, ${tokenText.length} chars`);

    if (detected.type === 'engine_key') {
      // Ключ движка — предупреждение + сохранение
      await ctx.reply(
        `🔐 <b>Обнаружен ${detected.name}</b>\n\n` +
        `Не отправляй секретные данные в чат — это небезопасно. ` +
        `В следующий раз используй /settings → Модель.\n\n` +
        `Сохраняю (${tokenText.length} символов)...`,
        { parse_mode: 'HTML' }
      );

      setWaitingInput(chatId, { field: 'engineKey', engineId: detected.engine });
      const result = handleSettingsInput(chatId, tokenText);
      if (result?.success) {
        await ctx.reply(result.success, { parse_mode: 'HTML' });
        if (result.restart) setTimeout(() => process.exit(0), 1500);
      } else if (result?.error) {
        await ctx.reply(result.error);
      }
    } else {
      // Любой другой секрет — только предупреждение
      await ctx.reply(
        `🔐 <b>Похоже на ${detected.name}!</b>\n\n` +
        `Не отправляй секретные данные в чат. Сообщение сохраняется в истории Telegram и может быть скомпрометировано.\n\n` +
        `Безопасный способ: /settings → 🔑 Переменные окружения — ` +
        `там ключи хранятся в зашифрованном <code>.env</code> файле на сервере.`,
        { parse_mode: 'HTML' }
      );
    }
    return;
  }

  // 4. Обычное сообщение → батч (ждём 500мс, вдруг ещё что-то придёт)
  addToBatch(chatId, ctx, async () => ({ type: 'text', prompt: text }));
});

// ── Голосовые ──

bot.on('message:voice', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const fileId = ctx.message.voice.file_id;

  addToBatch(ctx.chat.id, ctx, async () => {
    if (!config.deepgramKey) {
      return { type: 'error', message: '🔐 Голос не распознан — добавь DEEPGRAM_API_KEY в /settings → 🔑 Переменные' };
    }
    const filepath = await downloadFile(bot, fileId, '.ogg');
    const transcript = await transcribeVoice(filepath);
    if (transcript.startsWith('[')) {
      return { type: 'error', message: transcript };
    }
    return { type: 'voice', prompt: transcript, transcript };
  });
});

// ── Фото ──

bot.on('message:photo', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const photo = ctx.message.photo;
  const largest = photo[photo.length - 1];
  const caption = ctx.message.caption || '';

  addToBatch(ctx.chat.id, ctx, async () => {
    const filepath = await downloadFile(bot, largest.file_id, '.jpg');
    const prompt = `Пользователь отправил фото: ${filepath}\n` +
      (caption ? `Подпись: ${caption}\n` : '') +
      `Используй Read tool чтобы посмотреть изображение.`;
    return { type: 'photo', prompt };
  });
});

// ── Документы ──

bot.on('message:document', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;
  const ext = doc.file_name ? '.' + doc.file_name.split('.').pop() : '';

  // Если ждём ключ/токен — читаем содержимое файла как ключ
  const waiting = getWaitingInput(chatId);
  const textExts = ['.txt', '.env', '.key', '.rtf', '.text', '.cfg', '.conf'];
  if (waiting?.field === 'engineKey' && textExts.includes(ext.toLowerCase())) {
    try {
      const filepath = await downloadFile(bot, doc.file_id, ext);
      const { readFileSync } = await import('fs');
      let tokenContent = readFileSync(filepath, 'utf8').trim();
      // RTF — извлекаем чистый текст (убираем RTF-разметку)
      if (ext.toLowerCase() === '.rtf') {
        tokenContent = tokenContent.replace(/\{\\rtf[^}]*\}/g, '').replace(/\\[a-z]+\d*\s?/g, '').replace(/[{}]/g, '').trim();
      }
      console.log(`[bot] token from file: ${tokenContent.length} chars, file: ${doc.file_name}`);

      const result = handleSettingsInput(chatId, tokenContent);
      if (result?.success) {
        await ctx.reply(result.success, { parse_mode: 'HTML' });
        if (result.restart) {
          setTimeout(() => process.exit(0), 1500);
        }
      } else if (result?.error) {
        await ctx.reply(result.error);
      }
    } catch (err) {
      await ctx.reply(`Ошибка чтения файла: ${err.message}`);
    }
    return;
  }

  // Автодетект: файл с токеном (token.txt, token.rtf, etc.) даже без waiting state
  if (textExts.includes(ext.toLowerCase()) && /token|key|secret|oauth/i.test(doc.file_name || '')) {
    try {
      const filepath = await downloadFile(bot, doc.file_id, ext);
      const { readFileSync } = await import('fs');
      let content = readFileSync(filepath, 'utf8').trim();
      if (ext.toLowerCase() === '.rtf') {
        content = content.replace(/\{\\rtf[^}]*\}/g, '').replace(/\\[a-z]+\d*\s?/g, '').replace(/[{}]/g, '').trim();
      }
      const cleanContent = content.replace(/\s+/g, '');
      if (/^sk-ant-/i.test(cleanContent) || /^sk-[a-zA-Z0-9_-]{20,}/.test(cleanContent)) {
        console.log(`[bot] auto-detected token in file ${doc.file_name}: ${cleanContent.length} chars`);
        const engineId = cleanContent.startsWith('sk-ant-') ? 'claude' : 'codex';
        await ctx.reply(
          `⚠️ <b>Обнаружен токен в файле!</b>\n\nСохраняю (${cleanContent.length} символов)...`,
          { parse_mode: 'HTML' }
        );
        setWaitingInput(chatId, { field: 'engineKey', engineId });
        const result = handleSettingsInput(chatId, cleanContent);
        if (result?.success) {
          await ctx.reply(result.success, { parse_mode: 'HTML' });
          if (result.restart) setTimeout(() => process.exit(0), 1500);
        } else if (result?.error) {
          await ctx.reply(result.error);
        }
        return;
      }
    } catch { /* не токен — продолжаем как обычный файл */ }
  }

  const fileName = doc.file_name || 'unknown';
  const caption = ctx.message.caption || `Файл: ${fileName}`;

  addToBatch(chatId, ctx, async () => {
    const filepath = await downloadFile(bot, doc.file_id, ext);
    const prompt = `Пользователь отправил файл: ${filepath}\nИмя: ${fileName}\nПодпись: ${caption}\nПрочитай файл и ответь.`;
    return { type: 'document', prompt };
  });
});

// ── Запуск ──

console.log(`[bot] starting ${getAgentName()} (engine: ${engineInfo.name})...`);
startScheduler(bot);

bot.start({
  onStart: async () => {
    console.log(`[bot] ${getAgentName()} is running! Engine: ${engineInfo.name}`);

    // Регистрируем меню команд в Telegram
    const commands = [
      { command: 'start', description: 'Меню' },
      { command: 'newtask', description: 'Новая задача' },
      { command: 'stop', description: 'Остановить задачу' },
      { command: 'clear', description: 'Сбросить контекст' },
      { command: 'undo', description: 'Отменить правку' },
      { command: 'projects', description: 'Проекты' },
      { command: 'sessions', description: 'Сессии' },
      { command: 'connect', description: 'VS Code туннель' },
      { command: 'recovery', description: 'Аварийный доступ к серверу' },
      { command: 'settings', description: 'Настройки' },
      { command: 'status', description: 'Статус системы' },
      { command: 'cost', description: 'Расходы за день' },
      { command: 'monitor', description: 'Статус мониторинга' },
      { command: 'digest', description: 'Дайджест контента' },
      { command: 'sources', description: 'Каналы и аккаунты' },
      { command: 'skills', description: 'Навыки агента' },
      { command: 'feedback', description: 'Отзыв' },
      { command: 'help', description: 'Все команды' },
    ];
    await bot.api.setMyCommands(commands)
      .catch((err) => console.error(`[bot] setMyCommands failed: ${err.message}`));

    if (config.adminId) {
      const msg = isOnboarded()
        ? `${getAgentName()} перезапущен. Движок: ${engineInfo.name}`
        : `${getAgentName()} запущен! Напиши /start чтобы начать.`;
      bot.api.sendMessage(config.adminId, msg).catch(() => {});
    }
  },
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[bot] ${sig} received, shutting down...`);
    bot.stop();
    process.exit(0);
  });
}
