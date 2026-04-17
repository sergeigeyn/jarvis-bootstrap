// Jarvis Bootstrap — Telegram бот с поддержкой Claude / Codex / Gemini
import { Bot, InputFile } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { getSession, killSession, getEngineInfo } from './engine.js';
import { downloadFile, transcribeVoice, parseMediaMarkers, sendMedia } from './media.js';
import { processResponse } from './hooks.js';
import { getTrustLevel, getTrustName, getTrustState, recordSession } from './trust.js';
import { startScheduler } from './scheduler.js';
import {
  isOnboarded, getOnboardingState, setOnboardingState, clearOnboardingState,
  getWelcomeMessage, getGreetingAfterName, getReturningMessage,
  setOwnerName, completeOnboarding, getAgentName,
} from './onboarding.js';
import {
  buildSettingsKeyboard, getSettingsText, handleSettingsCallback,
  getWaitingInput, clearWaitingInput, handleSettingsInput,
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

// ── Основной обработчик ──

async function handleMessage(ctx, promptText) {
  if (!isAdmin(ctx)) {
    await ctx.reply('Доступ только для владельца. Настрой ADMIN_ID в .env');
    return;
  }

  const session = getSession(ctx.chat.id);

  if (session.busy) {
    await ctx.reply('Подожди, обрабатываю предыдущий запрос...');
    return;
  }

  recordSession();

  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  session.send(promptText, {
    onDone: async (response) => {
      clearInterval(typingInterval);
      if (response) {
        await handleResponse(ctx, response);
      } else {
        await ctx.reply('[Пустой ответ]');
      }
    },
    onError: async (err) => {
      clearInterval(typingInterval);
      await ctx.reply(`Ошибка: ${err.message.slice(0, 500)}`);
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
  cost:     { prompt: 'Покажи расходы за сегодня: использование API, токены, запросы. Проверь логи.', description: 'Расходы за день' },
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

bot.command('status', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const session = getSession(ctx.chat.id);
  const trust = getTrustState();
  await ctx.reply(
    `<b>Статус системы</b>\n\n` +
    `🤖 Агент: ${getAgentName()}\n` +
    `⚙️ Движок: ${engineInfo.name}\n` +
    `📊 Сессия: ${session.busy ? 'занята' : 'свободна'}\n` +
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
    const result = handleSettingsInput(chatId, text);
    if (result?.success) {
      await ctx.reply(result.success, { parse_mode: 'HTML' });
      // Смена движка — перезапуск через systemd
      if (result.restart) {
        setTimeout(() => process.exit(0), 1500);
      }
    } else if (result?.error) {
      await ctx.reply(result.error);
    }
    return;
  }

  // 3. Обычное сообщение → engine
  await handleMessage(ctx, text);
});

// ── Голосовые ──

bot.on('message:voice', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const fileId = ctx.message.voice.file_id;
  try {
    const filepath = await downloadFile(bot, fileId, '.ogg');
    const transcript = await transcribeVoice(filepath);
    await ctx.reply(`🎤 <i>${transcript}</i>`, { parse_mode: 'HTML' });
    await handleMessage(ctx, transcript);
  } catch (err) {
    await ctx.reply(`Ошибка обработки голосового: ${err.message}`);
  }
});

// ── Фото ──

bot.on('message:photo', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const photo = ctx.message.photo;
  const largest = photo[photo.length - 1];
  try {
    const filepath = await downloadFile(bot, largest.file_id, '.jpg');
    const caption = ctx.message.caption || 'Что на этом фото?';

    const prompt = `Пользователь отправил фото: ${filepath}\n` +
      `Подпись: ${caption}\n` +
      `Используй Read tool чтобы посмотреть изображение.`;

    await handleMessage(ctx, prompt);
  } catch (err) {
    await ctx.reply(`Ошибка обработки фото: ${err.message}`);
  }
});

// ── Документы ──

bot.on('message:document', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const doc = ctx.message.document;
  const ext = doc.file_name ? '.' + doc.file_name.split('.').pop() : '';
  try {
    const filepath = await downloadFile(bot, doc.file_id, ext);
    const caption = ctx.message.caption || `Файл: ${doc.file_name || 'unknown'}`;

    const prompt = `Пользователь отправил файл: ${filepath}\n` +
      `Имя: ${doc.file_name || 'unknown'}\n` +
      `Подпись: ${caption}\n` +
      `Прочитай файл и ответь.`;

    await handleMessage(ctx, prompt);
  } catch (err) {
    await ctx.reply(`Ошибка обработки файла: ${err.message}`);
  }
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
