// Обработка медиа: входящее (голос, фото, файлы) и исходящее (маркеры)
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync, createReadStream } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import https from 'https';
import http from 'http';
import { InputFile } from 'grammy';

const MEDIA_DIR = join(config.workspaceDir, '.media');
if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });

// ── Авто-очистка старых медиафайлов (>24ч) ──

const MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cleanupOldMedia() {
  try {
    const now = Date.now();
    const files = readdirSync(MEDIA_DIR);
    let cleaned = 0;
    for (const file of files) {
      try {
        const stat = statSync(join(MEDIA_DIR, file));
        if (now - stat.mtimeMs > MEDIA_MAX_AGE_MS) {
          unlinkSync(join(MEDIA_DIR, file));
          cleaned++;
        }
      } catch { /* skip */ }
    }
    if (cleaned > 0) console.log(`[media] cleaned ${cleaned} old files`);
  } catch { /* skip */ }
}

cleanupOldMedia();
setInterval(cleanupOldMedia, 60 * 60 * 1000);

// ── Скачивание файла из Telegram ──

export async function downloadFile(bot, fileId, ext = '') {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
  
  const filename = `${Date.now()}_${fileId.slice(-8)}${ext}`;
  const filepath = join(MEDIA_DIR, filename);
  
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => reject(new Error('File download timeout (30s)')), 30_000);
    mod.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timeout);
        res.resume(); // drain response
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timeout);
        writeFileSync(filepath, Buffer.concat(chunks));
        resolve(filepath);
      });
      res.on('error', (e) => { clearTimeout(timeout); reject(e); });
    }).on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

// ── Транскрипция голосовых через Deepgram ──

export async function transcribeVoice(filepath) {
  if (!config.deepgramKey) {
    return '[Голос не распознан — добавь DEEPGRAM_API_KEY в /settings → 🔑 Переменные]';
  }
  
  const { readFileSync } = await import('fs');
  const audioData = readFileSync(filepath);
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.deepgram.com',
      path: '/v1/listen?language=ru&model=nova-2',
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.deepgramKey}`,
        'Content-Type': 'audio/ogg',
        'Content-Length': audioData.length,
      },
    };
    
    const timeout = setTimeout(() => reject(new Error('Deepgram timeout (30s)')), 30_000);
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
          resolve(transcript || '[Не удалось распознать голосовое]');
        } catch (e) {
          resolve('[Ошибка распознавания голосового]');
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    req.write(audioData);
    req.end();
  });
}

// ── Парсинг медиа-маркеров в ответе Claude ──

const MARKER_RE = /\[(ФОТО|ФАЙЛ|СТИКЕР|ВИДЕО|АУДИО|ГОЛОС|GIF|PHOTO|FILE|STICKER|VIDEO|AUDIO|VOICE|ANIMATION):\s*(.+?)\]/gi;

const TYPE_MAP = {
  'ФОТО': 'photo', 'PHOTO': 'photo',
  'ФАЙЛ': 'document', 'FILE': 'document',
  'СТИКЕР': 'sticker', 'STICKER': 'sticker',
  'ВИДЕО': 'video', 'VIDEO': 'video',
  'АУДИО': 'audio', 'AUDIO': 'audio',
  'ГОЛОС': 'voice', 'VOICE': 'voice',
  'GIF': 'animation', 'ANIMATION': 'animation',
};

export function parseMediaMarkers(text) {
  const markers = [];
  let cleanText = text;
  
  let match;
  while ((match = MARKER_RE.exec(text)) !== null) {
    const type = TYPE_MAP[match[1].toUpperCase()];
    const rest = match[2].trim();
    
    // Разделяем путь и подпись
    const spaceIdx = rest.indexOf(' ');
    let path, caption;
    if (spaceIdx > 0 && !rest.startsWith('http')) {
      path = rest.slice(0, spaceIdx);
      caption = rest.slice(spaceIdx + 1);
    } else if (spaceIdx > 0 && rest.startsWith('http')) {
      // URL может содержать пробелы в caption
      const urlEnd = rest.indexOf(' ', rest.indexOf('/', 8));
      if (urlEnd > 0) {
        path = rest.slice(0, urlEnd);
        caption = rest.slice(urlEnd + 1);
      } else {
        path = rest;
      }
    } else {
      path = rest;
    }
    
    markers.push({ type, path, caption, raw: match[0] });
    cleanText = cleanText.replace(match[0], '');
  }
  
  return { cleanText: cleanText.trim(), markers };
}

// ── Отправка медиа в Telegram ──

export async function sendMedia(ctx, marker) {
  const { type, path, caption } = marker;
  const source = path.startsWith('http') ? path : new InputFile(createReadStream(path));
  const opts = caption ? { caption } : {};
  
  try {
    switch (type) {
      case 'photo': await ctx.replyWithPhoto(source, opts); break;
      case 'document': await ctx.replyWithDocument(source, opts); break;
      case 'sticker': await ctx.replyWithSticker(source); break;
      case 'video': await ctx.replyWithVideo(source, opts); break;
      case 'audio': await ctx.replyWithAudio(source, opts); break;
      case 'voice': await ctx.replyWithVoice(source, opts); break;
      case 'animation': await ctx.replyWithAnimation(source, opts); break;
    }
  } catch (err) {
    console.error(`[media] failed to send ${type} ${path}: ${err.message}`);
  }
}
