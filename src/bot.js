// Jarvis Bootstrap — Telegram бот с поддержкой Claude / Codex / Gemini
import { Bot, InputFile } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { getSession, killSession, getEngineInfo } from './engine.js';
import { downloadFile, transcribeVoice, parseMediaMarkers, sendMedia } from './media.js';
import { startScheduler } from './scheduler.js';

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

// ── Обработка ответа (медиа-маркеры + текст) ──

async function handleResponse(ctx, response) {
  const { cleanText, markers } = parseMediaMarkers(response);

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

// ── Команды ──

bot.command('start', async (ctx) => {
  await ctx.reply(
    `Привет! Я ${config.agentName}.\n\n` +
    `Движок: ${engineInfo.name}\n` +
    `Пиши текстом или отправляй голосовые — я всё пойму.`
  );
});

bot.command('reset', async (ctx) => {
  killSession(ctx.chat.id);
  await ctx.reply('Сессия сброшена.');
});

bot.command('status', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.reply(
    `Движок: ${engineInfo.name}\n` +
    `Сессия: ${session.busy ? 'занята' : 'свободна'}\n` +
    `Последняя активность: ${new Date(session.lastActivity).toLocaleTimeString()}`
  );
});

// ── Текст ──

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  await handleMessage(ctx, text);
});

// ── Голосовые ──

bot.on('message:voice', async (ctx) => {
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

console.log(`[bot] starting ${config.agentName} (engine: ${engineInfo.name})...`);
startScheduler(bot);

bot.start({
  onStart: () => {
    console.log(`[bot] ${config.agentName} is running! Engine: ${engineInfo.name}`);
    if (config.adminId) {
      bot.api.sendMessage(config.adminId, `${config.agentName} запущен.\nДвижок: ${engineInfo.name}`).catch(() => {});
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
