// Jarvis Bootstrap — Telegram бот с Claude Code CLI
import { Bot, InputFile } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { getSession, killSession } from './claude-session.js';
import { downloadFile, transcribeVoice, parseMediaMarkers, sendMedia } from './media.js';
import { startScheduler } from './scheduler.js';
import { existsSync, readFileSync } from 'fs';

const bot = new Bot(config.botToken);

// Auto-retry на rate limits
bot.api.config.use(autoRetry());

// ── Хелперы ──

function isAdmin(ctx) {
  if (!config.adminId) return true; // если ADMIN_ID не задан — все юзеры ok
  return ctx.from?.id === config.adminId;
}

async function sendLong(ctx, text, parseMode = 'HTML') {
  // Разбиваем длинные сообщения
  const chunks = splitMessage(text, config.messageMaxLen);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: parseMode });
    } catch {
      // Если HTML невалидный — отправляем без парсинга
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
    
    // Ищем точку разрыва: двойной перенос, одинарный перенос, пробел
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  
  return chunks;
}

// ── Обработка ответа Claude (медиа-маркеры + текст) ──

async function handleClaudeResponse(ctx, response) {
  const { cleanText, markers } = parseMediaMarkers(response);
  
  // Отправляем медиа
  for (const marker of markers) {
    await sendMedia(ctx, marker);
  }
  
  // Отправляем текст
  if (cleanText) {
    await sendLong(ctx, cleanText);
  }
}

// ── Основной обработчик сообщений ──

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
  
  // typing indicator
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});
  
  session.send(promptText, {
    onDone: async (response) => {
      clearInterval(typingInterval);
      if (response) {
        await handleClaudeResponse(ctx, response);
      } else {
        await ctx.reply('[Пустой ответ от Claude]');
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
    `Claude Code CLI агент в Telegram.\n` +
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
    `Сессия: ${session.busy ? 'занята' : 'свободна'}\n` +
    `Последняя активность: ${new Date(session.lastActivity).toLocaleTimeString()}`
  );
});

// ── Текст ──

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // неизвестные команды игнорим
  await handleMessage(ctx, text);
});

// ── Голосовые ──

bot.on('message:voice', async (ctx) => {
  const fileId = ctx.message.voice.file_id;
  try {
    const filepath = await downloadFile(bot, fileId, '.ogg');
    const transcript = await transcribeVoice(filepath);
    
    // Показываем транскрипт
    await ctx.reply(`🎤 <i>${transcript}</i>`, { parse_mode: 'HTML' });
    
    // Отправляем в Claude
    await handleMessage(ctx, transcript);
  } catch (err) {
    await ctx.reply(`Ошибка обработки голосового: ${err.message}`);
  }
});

// ── Фото ──

bot.on('message:photo', async (ctx) => {
  const photo = ctx.message.photo;
  const largest = photo[photo.length - 1]; // самое большое разрешение
  try {
    const filepath = await downloadFile(bot, largest.file_id, '.jpg');
    const caption = ctx.message.caption || 'Что на этом фото?';
    
    // Claude Code CLI не принимает изображения напрямую через --print
    // Передаём как контекст
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

console.log(`[bot] starting ${config.agentName}...`);
startScheduler(bot);

bot.start({
  onStart: () => {
    console.log(`[bot] ${config.agentName} is running!`);
    
    // Уведомление админа о старте
    if (config.adminId) {
      bot.api.sendMessage(config.adminId, `${config.agentName} запущен и готов к работе.`).catch(() => {});
    }
  },
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[bot] ${sig} received, shutting down...`);
    bot.stop();
    process.exit(0);
  });
}
