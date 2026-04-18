// Jarvis Bootstrap — Telegram бот с поддержкой Claude / Codex / Gemini
import { Bot, InputFile, InlineKeyboard } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { getSession, killSession, killAllSessions, getEngineInfo } from './engine.js';
import { downloadFile, transcribeVoice, parseMediaMarkers, sendMedia } from './media.js';
import { processResponse, detectSensitiveInput } from './hooks.js';
import { getTrustLevel, getTrustName, getTrustState, recordSession } from './trust.js';
import { startScheduler } from './scheduler.js';
import {
  getTodayCost, getCostHistory, getDailyLimit, getPermissionMode,
  getTimezone, isCostPaused, unpauseCost, setSessionId,
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
import { buildProjectsKeyboard, getProjectsText, handleProjectsCallback, switchProject, getCurrentProject } from './projects.js';

const bot = new Bot(config.botToken);
const engineInfo = getEngineInfo(config.engine);

bot.api.config.use(autoRetry());

bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;
  console.error(`[bot] error in ${ctx?.update?.update_id}: ${e.message || e}`);
  ctx?.reply?.('Произошла ошибка. Попробуй ещё раз или /clear.').catch(() => {});
});

// ── Хелперы ──

function isAdmin(ctx) {
  if (!config.adminId) return true;
  return ctx.from?.id === config.adminId;
}

async function sendLong(ctx, text, parseMode = 'HTML', replyMarkup = null) {
  const chunks = splitMessage(text, config.messageMaxLen);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const opts = { parse_mode: parseMode };
    if (isLast && replyMarkup) opts.reply_markup = replyMarkup;
    try {
      await ctx.reply(chunks[i], opts);
    } catch {
      // HTML невалидный — отправляем без тегов
      const plain = chunks[i].replace(/<[^>]+>/g, '');
      await ctx.reply(plain).catch(() => {});
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

    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt).trimStart();

    // Закрываем незакрытые HTML-теги в чанке
    const { closed, carry } = closeOpenTags(chunk);
    chunks.push(closed);
    // Открываем теги в начале следующего чанка
    if (carry) remaining = carry + remaining;
  }

  return chunks;
}

// Находит незакрытые HTML-теги и закрывает их в конце чанка,
// возвращает opening-теги для начала следующего чанка
function closeOpenTags(html) {
  const TAG_RE = /<\/?(\w+)[^>]*>/g;
  const stack = [];
  let m;
  while ((m = TAG_RE.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      // Closing tag — убираем из стека
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      stack.push(tag);
    }
  }
  if (stack.length === 0) return { closed: html, carry: '' };
  // Закрываем в обратном порядке, открываем в прямом
  const closers = stack.slice().reverse().map(t => `</${t}>`).join('');
  const openers = stack.map(t => `<${t}>`).join('');
  return { closed: html + closers, carry: openers };
}

// ── Обработка ответа (hooks → медиа-маркеры → текст) ──

async function handleResponse(ctx, response, replyMarkup = null) {
  const safe = processResponse(response);
  const { cleanText, markers } = parseMediaMarkers(safe);

  for (const marker of markers) {
    await sendMedia(ctx, marker);
  }

  if (cleanText) {
    await sendLong(ctx, cleanText, 'HTML', replyMarkup);
  } else if (markers.length > 0 && replyMarkup) {
    // Если ответ — только медиа, кнопки отдельным сообщением
    await ctx.reply('👆', { reply_markup: replyMarkup });
  }
}

// ── Кнопки действий после ответа ──

function buildActionKeyboard() {
  return new InlineKeyboard()
    .text('✔ Продолжай', 'action:continue')
    .text('✖ Стоп', 'action:stop')
    .row()
    .text('💬 Комментарий', 'action:comment');
}

// ── Очередь сообщений ──

const messageQueue = new Map(); // chatId → [{ ctx, promptText, addedAt }]
const QUEUE_TTL_MS = 3 * 60 * 1000; // 3 минуты — после этого сообщение протухает

async function processQueue(chatId) {
  const queue = messageQueue.get(chatId);
  if (!queue || queue.length === 0) return;
  // Убираем протухшие
  const now = Date.now();
  while (queue.length > 0 && now - queue[0].addedAt > QUEUE_TTL_MS) {
    const stale = queue.shift();
    stale.ctx.reply('⏳ Сообщение устарело (>3 мин в очереди), пропущено.').catch(() => {});
  }
  if (queue.length === 0) { messageQueue.delete(chatId); return; }
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

  // Транскрипции голосовых — одним сообщением (эскейпим HTML-сущности)
  if (transcripts.length > 0) {
    const escaped = transcripts.map(t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n');
    await ctx.reply(`🎤 <i>${escaped}</i>`, { parse_mode: 'HTML' });
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
    queue.push({ ctx, promptText, addedAt: Date.now() });
    messageQueue.set(ctx.chat.id, queue);
    await ctx.reply('⏳ в очереди');
    return;
  }

  recordSession();

  // Прогресс-сообщение — показываем СРАЗУ, не ждём CLI
  let progressMsg = await ctx.reply('🤔 Мозгую...').catch(() => null);
  let lastProgressText = '🤔 Мозгую...';

  // Typing ПОСЛЕ прогресс-сообщения (reply сбрасывает typing)
  await ctx.replyWithChatAction('typing').catch(() => {});
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 3000); // 3с — typing живёт ~5с, без гэпов
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
        // Обновляем typing после каждого edit (edit может сбросить индикатор)
        await ctx.replyWithChatAction('typing').catch(() => {});
      } catch { /* Telegram rate limit — пропускаем */ }
    },

    onDone: async (response, meta = {}) => {
      clearInterval(typingInterval);
      // Удаляем прогресс-сообщение
      if (progressMsg) {
        await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
      }
      if (response?.trim()) {
        // Футер: время + стоимость (всегда, если есть)
        const elapsed = meta.elapsed || 0;
        let footerContent = `⏱ ${elapsed}s`;
        if (meta.cost > 0) {
          footerContent += ` · $${meta.cost.toFixed(3)}`;
        }
        const footer = `\n\n<blockquote>${footerContent}</blockquote>`;
        // Кнопки только если агент упёрся в лимит turns (задача не завершена)
        const maxTurns = 25;
        const hitTurnLimit = (meta.numTurns || 0) >= maxTurns - 5; // 20+ из 25
        const keyboard = hitTurnLimit ? buildActionKeyboard() : null;
        await handleResponse(ctx, response + footer, keyboard);
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
    // /newtask — сначала сбрасываем сессию (и persistентный sessionId)
    if (cmd === 'newtask') { killSession(ctx.chat.id); setSessionId(null); }
    await handleMessage(ctx, prompt);
  });
}

// ── Команды (с собственной логикой) ──

bot.command('project', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const name = ctx.match?.trim();
  if (!name) {
    await ctx.reply(getProjectsText(), {
      parse_mode: 'HTML',
      reply_markup: buildProjectsKeyboard(),
    });
    return;
  }
  // Валидация: проверяем что проект существует
  const { existsSync } = await import('fs');
  const { join } = await import('path');
  const isWorkspace = name.startsWith('~/workspace');
  const projectPath = isWorkspace
    ? join(config.home, name.replace('~', ''))
    : join(config.projectsDir, name);
  if (!existsSync(projectPath)) {
    await ctx.reply(`Проект <code>${name}</code> не найден. Используй /project без аргумента для списка.`, { parse_mode: 'HTML' });
    return;
  }
  switchProject(name);
  killSession(ctx.chat.id);
  setSessionId(null);
  await ctx.reply(`Проект: <b>${name}</b>. Сессия сброшена.`, { parse_mode: 'HTML' });
});

// /projects — алиас для /project (inline-меню)
bot.command('projects', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(getProjectsText(), {
    parse_mode: 'HTML',
    reply_markup: buildProjectsKeyboard(),
  });
});

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
  setSessionId(null);
  await ctx.reply('Контекст сброшен. Новая сессия.');
});

// /reset — алиас для /clear (обратная совместимость)
bot.command('reset', async (ctx) => {
  killSession(ctx.chat.id);
  setSessionId(null);
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
    `/start — Меню\n` +
    `/project — Проекты (переключение)\n` +
    `/stop — Остановить задачу\n` +
    `/clear — Сбросить контекст\n` +
    `/settings — Настройки\n` +
    `/status — Статус системы\n` +
    `/cost — Расходы за день\n` +
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
    // killSession перед handleProjectsCallback — при switch проект сбросит сессию
    if (data.startsWith('projects:switch:')) {
      killSession(ctx.chat.id);
    }
    await handleProjectsCallback(ctx, handleMessage);
    return;
  }

  if (data.startsWith('action:')) {
    // Убираем кнопки
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await ctx.answerCallbackQuery();

    if (data === 'action:continue') {
      await handleMessage(ctx, 'Продолжай.');
    } else if (data === 'action:stop') {
      const session = getSession(ctx.chat.id);
      if (session.busy) {
        session.kill();
        await ctx.reply('Задача остановлена.');
      } else {
        await ctx.reply('Нет активной задачи.');
      }
    } else if (data === 'action:comment') {
      // Следующее сообщение пойдёт с контекстом сессии
    }
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
    // Отмена ввода
    if (/^(отмена|cancel|отмени|назад)$/i.test(text.trim())) {
      clearWaitingInput(chatId);
      await ctx.reply('Отменено.');
      return;
    }
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

// ── Отредактированные сообщения ──

bot.on('edited_message:text', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const text = ctx.update.edited_message.text;
  if (text.startsWith('/')) return;
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  // Если агент не занят — обработать как новое сообщение с пометкой
  if (!session.busy) {
    const prompt = `[Пользователь отредактировал предыдущее сообщение]\n${text}`;
    addToBatch(chatId, ctx, async () => ({ type: 'text', prompt }));
  }
  // Если занят — игнорируем, чтобы не путать контекст
});

// ── Голосовые ──

bot.on('message:voice', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const fileId = ctx.message.voice.file_id;

  addToBatch(ctx.chat.id, ctx, async () => {
    const filepath = await downloadFile(bot, fileId, '.ogg');
    // Deepgram — быстрый специализированный STT
    if (config.deepgramKey) {
      const transcript = await transcribeVoice(filepath);
      if (!transcript.startsWith('[')) {
        return { type: 'voice', prompt: transcript, transcript };
      }
      // Deepgram ошибся — fallback на CLI
    }
    // Fallback: отправляем аудиофайл в CLI — агент сам расшифрует через доступные API
    const prompt = `Пользователь отправил голосовое сообщение. Аудиофайл: ${filepath}\nРасшифруй содержимое и ответь на запрос пользователя.`;
    return { type: 'text', prompt };
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
    const prompt = `Пользователь отправил фото. Файл уже сохранён — открой через Read:\nФото: ${filepath}` +
      (caption ? `\nПодпись: ${caption}` : '');
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
    const prompt = `Пользователь отправил файл. Файл уже сохранён — открой через Read:\nФайл: ${filepath}\nИмя: ${fileName}\nПодпись: ${caption}`;
    return { type: 'document', prompt };
  });
});

// ── Видео ──

bot.on('message:video', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const video = ctx.message.video;
  const caption = ctx.message.caption || '';

  addToBatch(ctx.chat.id, ctx, async () => {
    const ext = video.mime_type?.includes('mp4') ? '.mp4' : '.video';
    const filepath = await downloadFile(bot, video.file_id, ext);
    const prompt = `Пользователь отправил видео. Файл: ${filepath}` +
      (caption ? `\nПодпись: ${caption}` : '');
    return { type: 'video', prompt };
  });
});

// ── Стикеры ──

bot.on('message:sticker', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const sticker = ctx.message.sticker;
  const emoji = sticker.emoji || '';
  addToBatch(ctx.chat.id, ctx, async () => ({
    type: 'text',
    prompt: `Пользователь отправил стикер ${emoji}. Отреагируй коротко.`,
  }));
});

// ── Аудио (файлы, не голосовые) ──

bot.on('message:audio', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const audio = ctx.message.audio;
  const caption = ctx.message.caption || '';

  addToBatch(ctx.chat.id, ctx, async () => {
    const ext = audio.file_name ? '.' + audio.file_name.split('.').pop() : '.audio';
    const filepath = await downloadFile(bot, audio.file_id, ext);
    const prompt = `Пользователь отправил аудиофайл. Файл: ${filepath}\nНазвание: ${audio.title || audio.file_name || 'unknown'}` +
      (caption ? `\nПодпись: ${caption}` : '');
    return { type: 'audio', prompt };
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
      { command: 'project', description: 'Проект (переключить/меню)' },
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
  process.on(sig, async () => {
    console.log(`[bot] ${sig} received, shutting down...`);
    // Уведомить пользователя и убить CLI-процессы
    if (config.adminId) {
      await bot.api.sendMessage(config.adminId, '🔄 Перезапускаюсь...').catch(() => {});
    }
    killAllSessions();
    bot.stop();
    process.exit(0);
  });
}
