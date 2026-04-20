// Мониторинг источников: RSS, GitHub, YouTube + расширяемо
// Все типы работают без API-ключей (через RSS/Atom фиды)
// Саммари через LLM (Anthropic→Haiku / OpenAI→GPT-4o-mini / OpenRouter→Haiku) если ключ доступен
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';

const MONITOR_DIR = join(config.dataDir, 'monitor');
const CONFIG_PATH = join(config.dataDir, 'monitor.json');
const SEEN_PATH = join(MONITOR_DIR, 'seen.json');

// ── Типы источников и какие ключи им нужны ──

const SOURCE_TYPES = {
  rss:     { label: 'RSS/Atom', envKey: null, hint: 'URL фида, ссылка на YouTube-канал' },
  github:  { label: 'GitHub', envKey: null, hint: 'Репозиторий (owner/repo) — через Atom feed, без токена' },
  youtube: { label: 'YouTube', envKey: null, hint: 'Ссылка или @handle — через RSS, без API-ключа' },
};

// ── Конфиг ──

let monitorConfig = { sources: [], digestHour: 9, enabled: true };

function ensureDir() {
  if (!existsSync(MONITOR_DIR)) mkdirSync(MONITOR_DIR, { recursive: true });
}

export function loadMonitorConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      monitorConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch { /* ignore */ }
  }
  return monitorConfig;
}

function saveMonitorConfig() {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(monitorConfig, null, 2));
}

// ── Seen (дедупликация) ──

let seen = {};

function loadSeen() {
  if (existsSync(SEEN_PATH)) {
    try { seen = JSON.parse(readFileSync(SEEN_PATH, 'utf8')); } catch { seen = {}; }
  }
}

function saveSeen() {
  ensureDir();
  writeFileSync(SEEN_PATH, JSON.stringify(seen));
}

function markSeen(sourceId, itemId) {
  if (!seen[sourceId]) seen[sourceId] = [];
  if (!seen[sourceId].includes(itemId)) {
    seen[sourceId].push(itemId);
    // Храним последние 200 записей на источник
    if (seen[sourceId].length > 200) seen[sourceId] = seen[sourceId].slice(-200);
  }
}

function isSeen(sourceId, itemId) {
  return seen[sourceId]?.includes(itemId) || false;
}

// ── Fetchers ──

async function fetchRSS(source) {
  const items = [];
  try {
    const res = await fetch(source.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return items;
    const xml = await res.text();

    // Простой парсинг RSS/Atom без зависимостей
    const entries = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const entry of entries.slice(0, 10)) {
      const title = entry.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1] || '';
      const link = entry.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1]
        || entry.match(/<link[^>]*>(.*?)<\/link>/i)?.[1] || '';
      const pubDate = entry.match(/<pubDate[^>]*>(.*?)<\/pubDate>|<published[^>]*>(.*?)<\/published>|<updated[^>]*>(.*?)<\/updated>/i);
      const date = pubDate?.[1] || pubDate?.[2] || pubDate?.[3] || '';
      // Извлекаем описание (description / summary / media:description)
      const descMatch = entry.match(/<(?:media:)?description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:media:)?description>|<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);
      const rawDesc = descMatch?.[1] || descMatch?.[2] || '';
      const description = decodeEntities(rawDesc.replace(/<[^>]+>/g, '')).trim().slice(0, 500);

      const id = link || title;
      if (id) items.push({ id, title: decodeEntities(title), link, date, description, source: source.name });
    }
  } catch (err) {
    console.error(`[monitor] RSS fetch error (${source.name}): ${err.message}`);
  }
  return items;
}

async function fetchGitHub(source) {
  // Используем публичный Atom feed — без API-ключа
  const url = `https://github.com/${source.repo}/releases.atom`;
  return fetchRSS({ ...source, url });
}

async function fetchYouTube(source) {
  // Используем публичный RSS — без API-ключа
  const channelId = source.channelId;
  if (!channelId) return [];
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  return fetchRSS({ ...source, url });
}

const FETCHERS = { rss: fetchRSS, github: fetchGitHub, youtube: fetchYouTube };

function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ── Саммари через LLM ──

async function summarizeItems(items) {
  if (!items.length) return items;

  // Определяем доступный API по ключу движка пользователя
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  // OAuth-токены подписки не годятся для API-вызовов
  const isOAuthOnly = !anthropicKey && !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!anthropicKey && !openaiKey && !openrouterKey) return items;
  if (isOAuthOnly && !openaiKey && !openrouterKey) return items;

  const toSummarize = items.filter(i => i.description && i.description.length > 50);
  if (!toSummarize.length) return items;

  const content = toSummarize.map((item, i) =>
    `[${i + 1}] ${item.title}\n${item.description.slice(0, 300)}`
  ).join('\n\n');

  const prompt = `Кратко опиши каждый пункт (1-2 предложения на русском). Формат: [N] саммари\n\n${content}`;

  try {
    let responseText = '';

    if (anthropicKey) {
      // Anthropic API → Haiku (дёшево)
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return items;
      const data = await res.json();
      responseText = data.content?.[0]?.text || '';
    } else if (openaiKey) {
      // OpenAI API → GPT-4o-mini (дёшево)
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return items;
      const data = await res.json();
      responseText = data.choices?.[0]?.message?.content || '';
    } else if (openrouterKey) {
      // OpenRouter → Haiku (пользователь добавил ключ сам)
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4-5-20251001',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return items;
      const data = await res.json();
      responseText = data.choices?.[0]?.message?.content || '';
    }

    // Парсим ответ — [1] ..., [2] ...
    for (let i = 0; i < toSummarize.length; i++) {
      const re = new RegExp(`\\[${i + 1}\\]\\s*(.+?)(?=\\[\\d+\\]|$)`, 's');
      const match = responseText.match(re);
      if (match) toSummarize[i].summary = match[1].trim().slice(0, 200);
    }
  } catch (err) {
    console.error(`[monitor] summarize error: ${err.message}`);
  }

  return items;
}

// ── Основной цикл: проверка всех источников ──

export async function checkAllSources() {
  loadSeen();
  const newItems = [];

  for (const source of monitorConfig.sources) {
    if (!source.enabled) continue;
    const fetcher = FETCHERS[source.type];
    if (!fetcher) continue;

    const items = await fetcher(source);
    for (const item of items) {
      if (!isSeen(source.id, item.id)) {
        markSeen(source.id, item.id);
        newItems.push(item);
      }
    }
  }

  saveSeen();

  // Саммари через LLM (если есть OPENROUTER_API_KEY)
  if (newItems.length > 0) {
    await summarizeItems(newItems);
  }

  return newItems;
}

// ── Первый запуск: пометить всё как прочитанное ──

export async function initSeen() {
  loadSeen();
  for (const source of monitorConfig.sources) {
    if (!source.enabled) continue;
    const fetcher = FETCHERS[source.type];
    if (!fetcher) continue;
    const items = await fetcher(source);
    for (const item of items) markSeen(source.id, item.id);
  }
  saveSeen();
}

// ── Форматирование дайджеста ──

export function formatDigest(items) {
  if (!items.length) return null;

  let text = `📡 <b>Мониторинг</b> — ${items.length} новых:\n\n`;
  const grouped = {};
  for (const item of items) {
    if (!grouped[item.source]) grouped[item.source] = [];
    grouped[item.source].push(item);
  }

  for (const [source, sourceItems] of Object.entries(grouped)) {
    text += `<b>${escapeHtml(source)}</b>:\n`;
    for (const item of sourceItems.slice(0, 5)) {
      const title = escapeHtml(item.title).slice(0, 80);
      if (item.link) {
        text += `  → <a href="${item.link}">${title}</a>\n`;
      } else {
        text += `  → ${title}\n`;
      }
      if (item.summary) {
        text += `    <i>${escapeHtml(item.summary)}</i>\n`;
      }
    }
    if (sourceItems.length > 5) text += `  ... и ещё ${sourceItems.length - 5}\n`;
    text += '\n';
  }

  return text.trim();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Управление источниками ──

export function addSource(type, name, params) {
  const id = `${type}_${Date.now()}`;
  const source = { id, type, name, enabled: true, createdAt: new Date().toISOString(), ...params };
  monitorConfig.sources.push(source);
  saveMonitorConfig();
  return source;
}

export function removeSource(sourceId) {
  monitorConfig.sources = monitorConfig.sources.filter(s => s.id !== sourceId);
  delete seen[sourceId];
  saveMonitorConfig();
  saveSeen();
}

export function listSources() {
  return monitorConfig.sources;
}

export function getSourceTypes() {
  return SOURCE_TYPES;
}

// ── Проверка доступности API-ключа ──

export function checkSourceKey(type) {
  const info = SOURCE_TYPES[type];
  if (!info || !info.envKey) return { ok: true };
  const hasKey = !!process.env[info.envKey];
  return { ok: hasKey, envKey: info.envKey };
}

// ── Inline-клавиатура ──

export function buildMonitorKeyboard() {
  const kb = new InlineKeyboard();
  const sources = monitorConfig.sources;

  if (sources.length > 0) {
    // Список источников (по 1 в ряд, toggle enabled)
    for (const s of sources) {
      const icon = s.enabled ? '✓' : '✗';
      const typeLabel = SOURCE_TYPES[s.type]?.label || s.type;
      kb.text(`${icon} ${s.name} (${typeLabel})`, `mon:toggle:${s.id}`).row();
    }
    kb.text('❌ Удалить источник', 'mon:remove').row();
  }

  kb.text('➕ Добавить источник', 'mon:add').row();
  kb.text('🔄 Проверить сейчас', 'mon:check').row();
  kb.text('« Назад', 'menu:back');
  return kb;
}

export function buildAddSourceKeyboard() {
  const kb = new InlineKeyboard();
  for (const [type, info] of Object.entries(SOURCE_TYPES)) {
    kb.text(`${info.label}`, `mon:add:${type}`).row();
  }
  kb.text('« Назад', 'mon:back');
  return kb;
}

export function buildRemoveKeyboard() {
  const kb = new InlineKeyboard();
  for (const s of monitorConfig.sources) {
    kb.text(`❌ ${s.name}`, `mon:rm:${s.id}`).row();
  }
  kb.text('« Назад', 'mon:back');
  return kb;
}

// ── Текст статуса ──

export function getMonitorText() {
  const sources = monitorConfig.sources;
  if (!sources.length) {
    return '📡 <b>Мониторинг</b>\n\nИсточников пока нет. Добавь через кнопку ниже.';
  }

  let text = `📡 <b>Мониторинг</b> (${sources.length}):\n\n`;
  for (const s of sources) {
    const icon = s.enabled ? '✅' : '⏸';
    const typeLabel = SOURCE_TYPES[s.type]?.label || s.type;
    text += `${icon} <b>${escapeHtml(s.name)}</b> — ${typeLabel}\n`;
  }

  return text;
}

// ── Callback обработчик ──

// Состояние ожидания ввода от пользователя
let pendingAdd = null;

export function getPendingAdd() { return pendingAdd; }
export function clearPendingAdd() { pendingAdd = null; }

export async function handleMonitorCallback(ctx, handleMessage) {
  const data = ctx.callbackQuery.data;

  if (data === 'mon:back') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(getMonitorText(), {
      parse_mode: 'HTML',
      reply_markup: buildMonitorKeyboard(),
    }).catch(() => {});
    return;
  }

  // Добавить — выбор типа
  if (data === 'mon:add') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '📡 Выбери тип источника:',
      { parse_mode: 'HTML', reply_markup: buildAddSourceKeyboard() },
    ).catch(() => {});
    return;
  }

  // Добавить — конкретный тип
  if (data.startsWith('mon:add:')) {
    const type = data.replace('mon:add:', '');
    const info = SOURCE_TYPES[type];
    if (!info) { await ctx.answerCallbackQuery({ text: 'Неизвестный тип' }); return; }

    // Ожидаем ввод от пользователя
    pendingAdd = { type, info };
    await ctx.answerCallbackQuery();

    let prompt = '';
    if (type === 'rss') prompt = 'Отправь URL фида или ссылку на YouTube-канал:';
    else if (type === 'github') prompt = 'Отправь репозиторий — ссылку или <code>owner/repo</code>:';
    else if (type === 'youtube') prompt = 'Отправь ссылку на канал (youtube.com/@handle) или ID (UCxxxx):';

    await ctx.editMessageText(prompt, { parse_mode: 'HTML' }).catch(() => {});
    return;
  }

  // Toggle enabled
  if (data.startsWith('mon:toggle:')) {
    const id = data.replace('mon:toggle:', '');
    const source = monitorConfig.sources.find(s => s.id === id);
    if (source) {
      source.enabled = !source.enabled;
      saveMonitorConfig();
    }
    await ctx.answerCallbackQuery({ text: source ? (source.enabled ? 'Включён' : 'На паузе') : 'Не найден' });
    await ctx.editMessageText(getMonitorText(), {
      parse_mode: 'HTML', reply_markup: buildMonitorKeyboard(),
    }).catch(() => {});
    return;
  }

  // Удалить — показать список
  if (data === 'mon:remove') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Выбери источник для удаления:', {
      reply_markup: buildRemoveKeyboard(),
    }).catch(() => {});
    return;
  }

  // Удалить — конкретный
  if (data.startsWith('mon:rm:')) {
    const id = data.replace('mon:rm:', '');
    const source = monitorConfig.sources.find(s => s.id === id);
    removeSource(id);
    await ctx.answerCallbackQuery({ text: source ? `Удалён: ${source.name}` : 'Не найден' });
    await ctx.editMessageText(getMonitorText(), {
      parse_mode: 'HTML', reply_markup: buildMonitorKeyboard(),
    }).catch(() => {});
    return;
  }

  // Проверить сейчас
  if (data === 'mon:check') {
    await ctx.answerCallbackQuery({ text: 'Проверяю...' });
    const items = await checkAllSources();
    const digest = formatDigest(items);
    if (digest) {
      await ctx.reply(digest, { parse_mode: 'HTML' }).catch(() => {});
    } else {
      await ctx.reply('Нового ничего нет.').catch(() => {});
    }
    return;
  }

  await ctx.answerCallbackQuery();
}

// ── YouTube URL → RSS ──

function youtubeUrlToChannelId(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('youtube.com') && !u.hostname.includes('youtu.be')) return null;

    // youtube.com/channel/UCxxxx — прямой ID
    const chanMatch = u.pathname.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (chanMatch) return { channelId: chanMatch[1], handle: null };

    // youtube.com/@handle — нужен резолв
    const handleMatch = u.pathname.match(/\/@([a-zA-Z0-9_.-]+)/);
    if (handleMatch) return { channelId: null, handle: handleMatch[1], resolveUrl: url };

    return null;
  } catch { return null; }
}

async function resolveYoutubeChannelId(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (!res.ok) return null;
    const html = await res.text();
    // Ищем UC-идентификатор — надёжнее чем искать по ключу channelId
    const match = html.match(/"(UC[a-zA-Z0-9_-]{20,})"/);
    return match?.[1] || null;
  } catch { return null; }
}

function youtubeUrlToRss(url) {
  const parsed = youtubeUrlToChannelId(url);
  if (!parsed) return null;
  if (parsed.channelId) {
    return {
      rssUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${parsed.channelId}`,
      name: parsed.channelId,
    };
  }
  // @handle — вернём промис-маркер, обработаем в handleMonitorInput
  return { needsResolve: true, handle: parsed.handle, resolveUrl: parsed.resolveUrl };
}

// ── Обработка текстового ввода при добавлении источника ──

export async function handleMonitorInput(text) {
  if (!pendingAdd) return null;

  const { type } = pendingAdd;
  let name, params;

  if (type === 'rss') {
    let url = text.trim();
    if (!url.startsWith('http')) return { error: 'URL должен начинаться с http:// или https://' };

    // YouTube-ссылки → автоконвертация в RSS-фид (без API-ключа)
    const ytConvert = youtubeUrlToRss(url);
    if (ytConvert && ytConvert.needsResolve) {
      // @handle → резолвим channel_id со страницы канала
      const channelId = await resolveYoutubeChannelId(ytConvert.resolveUrl);
      if (!channelId) return { error: `Не удалось определить channel_id для @${ytConvert.handle}. Попробуй ссылку формата youtube.com/channel/UCxxxx` };
      url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      name = `YT: @${ytConvert.handle}`;
    } else if (ytConvert) {
      url = ytConvert.rssUrl;
      name = `YT: ${ytConvert.name}`;
    } else {
      name = new URL(url).hostname.replace('www.', '');
    }
    params = { url };
  } else if (type === 'github') {
    const repo = text.trim().replace('https://github.com/', '');
    if (!repo.includes('/')) return { error: 'Формат: owner/repo' };
    name = repo;
    params = { repo };
  } else if (type === 'youtube') {
    let input = text.trim();
    let resolvedName = input;

    // Ссылка на канал → резолвим
    if (input.startsWith('http') && input.includes('youtube.com')) {
      const ytConvert = youtubeUrlToRss(input);
      if (ytConvert && ytConvert.needsResolve) {
        const channelId = await resolveYoutubeChannelId(ytConvert.resolveUrl);
        if (!channelId) return { error: `Не удалось определить channel_id. Попробуй формат UCxxxx` };
        input = channelId;
        resolvedName = `@${ytConvert.handle}`;
      } else if (ytConvert) {
        input = ytConvert.name;
      }
    }
    // @handle без https → резолвим
    else if (input.startsWith('@')) {
      const handle = input.replace('@', '');
      const channelId = await resolveYoutubeChannelId(`https://www.youtube.com/@${handle}`);
      if (!channelId) return { error: `Не удалось найти канал ${input}. Попробуй ссылку или ID (UCxxxx)` };
      resolvedName = input;
      input = channelId;
    }

    name = resolvedName;
    params = { channelId: input };
  } else {
    return { error: 'Неизвестный тип' };
  }

  const source = addSource(type, name, params);
  pendingAdd = null;
  return { source };
}

// ── Init ──

loadMonitorConfig();
ensureDir();
