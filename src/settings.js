// Меню настроек — inline-клавиатура в Telegram
import { InlineKeyboard } from 'grammy';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { getProfile, setOwnerName, setAgentName, resetOnboarding, getAgentName, getOwnerName } from './onboarding.js';
import { getEngineInfo, listEngines } from './engine.js';
import { getTrustState, getTrustName } from './trust.js';

// ── Состояние ожидания ввода ──

const waitingInput = new Map();

export function getWaitingInput(chatId) {
  return waitingInput.get(chatId) || null;
}

export function clearWaitingInput(chatId) {
  waitingInput.delete(chatId);
}

export function setWaitingInput(chatId, state) {
  waitingInput.set(chatId, state);
}

// ── Каталог сервисов (человеческие названия для env vars) ──

const SERVICE_CATALOG = [
  { id: 'openrouter', label: 'OpenRouter (модели AI)', vars: ['OPENROUTER_API_KEY'] },
  { id: 'github', label: 'GitHub (репозитории)', vars: ['GITHUB_TOKEN'] },
  { id: 'railway', label: 'Railway (бэкенд)', vars: ['RAILWAY_TOKEN', 'RAILWAY_PROJECT_ID'] },
  { id: 'vercel', label: 'Vercel (фронтенд)', vars: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID'] },
  { id: 'deepgram', label: 'Deepgram (голосовые)', vars: ['DEEPGRAM_API_KEY'] },
  { id: 'voyage', label: 'Voyage AI (семантический поиск)', vars: ['VOYAGE_API_KEY'] },
  { id: 'serper', label: 'Serper (веб-поиск)', vars: ['SERPER_API_KEY'] },
  { id: 'falai', label: 'FALAI', vars: ['FALAI'] },
  { id: 'apify', label: 'APIFY', vars: ['APIFY'] },
  { id: 'trustmrr', label: 'TRUSTMRR', vars: ['TRUSTMRR'] },
  { id: 'producthunt', label: 'PRODUCTHUNT_TOKEN', vars: ['PRODUCTHUNT_TOKEN'] },
  { id: 'kwork', label: 'BOT_TOKEN_KWORK', vars: ['BOT_TOKEN_KWORK'] },
  { id: 'n8n', label: 'n8n (автоматизация)', vars: ['N8N_API_KEY', 'N8N_API_URL'] },
  { id: 'contenzavod', label: 'Контент Фабрика', vars: ['BOT_TOKEN_CONTENZAVOD'], desc: 'Контент Фабрика Бот' },
  { id: 'helper_aishnik', label: 'Аишник Хелпер', vars: ['BOT_TOKEN_HELPER_AISHNIK'], desc: 'Агент для развертывания агентов' },
];

const SUGGESTED_SERVICES = [
  { id: 'twitter', label: 'X/Twitter (мониторинг)', vars: ['X_API_KEY'], hint: 'API ключ для мониторинга X/Twitter' },
  { id: 'supabase', label: 'Supabase (база данных)', vars: ['SUPABASE_ANON_KEY'], hint: 'Anon Key из настроек проекта Supabase' },
];

// Системные переменные — показываем с 🔒, не дaём редактировать
const SYSTEM_DISPLAY_VARS = [
  'BOT_TOKEN', 'IIA_WORKSPACE_DIR', 'IIA_SESSION_DIR', 'NODE_ENV',
  'SYNC_KEY', 'SYNC_URL', 'ADMIN_ID', 'CLAUDE_CODE_OAUTH_TOKEN',
];

// ── Карта ключей по движкам ──

const ENGINE_KEY_MAP = {
  claude: {
    env: 'ANTHROPIC_API_KEY',
    hint: 'Anthropic API Key (sk-ant-...)',
    guide:
      `<b>Подключение Claude Code</b>\n\n` +
      `<b>Вариант A — подписка Max ($100/мес):</b>\n` +
      `1. Оформи подписку Claude Max на claude.ai\n` +
      `2. Открой <b>Терминал</b> на своём компе:\n` +
      `   Mac: Cmd+Пробел → Terminal\n` +
      `   Win: Win+R → <code>cmd</code>\n` +
      `3. Если Claude Code ещё не установлен, введи:\n` +
      `   <code>npm install -g @anthropic-ai/claude-code</code>\n` +
      `4. Затем введи в терминале:\n` +
      `   <code>claude setup-token</code>\n` +
      `5. Откроется браузер — войди в свой аккаунт Anthropic\n` +
      `6. Вернись в терминал — там появится токен. Скопируй его\n` +
      `7. Вставь токен сюда ↓\n\n` +
      `⚠️ <b>Токен длинный — Telegram может обрезать!</b>\n` +
      `Отправь его одним из способов:\n` +
      `• Оберни в бэктик: <code>\`sk-ant-oat-...\`</code>\n` +
      `• Или сохрани в .txt файл и отправь файлом\n\n` +
      `<b>Вариант B — API credits (оплата за токены):</b>\n` +
      `1. Зайди на console.anthropic.com\n` +
      `2. Settings → API Keys → Create Key\n` +
      `3. Пополни баланс (Settings → Billing)\n` +
      `4. Вставь ключ <code>sk-ant-...</code> сюда ↓`,
  },
  codex: {
    env: 'OPENAI_API_KEY',
    hint: 'OpenAI API Key (sk-...)',
    guide:
      `<b>Подключение Codex</b>\n\n` +
      `<b>Вариант A — подписка Plus/Pro ($20-200/мес):</b>\n` +
      `1. Оформи подписку ChatGPT Plus/Pro на chatgpt.com\n` +
      `2. Открой <b>Терминал</b> на своём компе:\n` +
      `   Mac: Cmd+Пробел → Terminal\n` +
      `   Win: Win+R → <code>cmd</code>\n` +
      `3. Если Codex ещё не установлен, введи:\n` +
      `   <code>npm install -g @openai/codex</code>\n` +
      `4. Затем введи в терминале:\n` +
      `   <code>codex login</code>\n` +
      `5. Откроется браузер — войди в свой аккаунт OpenAI\n` +
      `6. Готово. Открой файл:\n` +
      `   <code>~/.codex/auth.json</code>\n` +
      `   Скопируй значение api_key\n` +
      `7. Вставь ключ сюда ↓\n\n` +
      `⚠️ <b>Токен длинный — Telegram может обрезать!</b>\n` +
      `Отправь его одним из способов:\n` +
      `• Оберни в бэктик: <code>\`sk-...\`</code>\n` +
      `• Или сохрани в .txt файл и отправь файлом\n\n` +
      `<b>Вариант B — API key (оплата за токены):</b>\n` +
      `1. Зайди на platform.openai.com\n` +
      `2. API Keys → Create new secret key\n` +
      `3. Пополни баланс (Settings → Billing)\n` +
      `4. Вставь ключ <code>sk-...</code> сюда ↓`,
  },
};

// ── Модели ──

const CLAUDE_MODELS = [
  { id: 'opus', name: 'Opus 4.6', modelId: 'claude-opus-4-6', emoji: '🧠' },
  { id: 'sonnet', name: 'Sonnet 4.6', modelId: 'claude-sonnet-4-6', emoji: '⚡' },
  { id: 'haiku', name: 'Haiku 4.5', modelId: 'claude-haiku-4-5-20251001', emoji: '🍃' },
];

function getCurrentModel() {
  const modelEnv = process.env.CLAUDE_MODEL;
  if (modelEnv) {
    const found = CLAUDE_MODELS.find(m => m.modelId === modelEnv || m.id === modelEnv);
    if (found) return found;
  }
  return CLAUDE_MODELS[0]; // Opus по умолчанию
}

// ── Режим работы ──

const MODES = ['авто', 'ручной', 'plan'];
let currentMode = 'авто';

// ── Часовой пояс ──

let timezone = 'Moscow';

// ── Текст карточки настроек (как в reference) ──

export function getSettingsText() {
  const model = getCurrentModel();
  const modelStatus = config.engineKey ? model.name : `${model.name} (❌ не подключён)`;
  return (
    `⚙️ <b>Настройки</b>\n\n` +
    `📡 Подключение: <b>${getConnectionType()}</b>\n` +
    `🔒 Режим: 😈 <b>${currentMode}</b>\n` +
    `🧠 Модель: <b>${modelStatus}</b>\n` +
    `🕐 Часовой пояс: <b>${timezone}</b>\n` +
    `💰 Лимит: <b>без лимита</b> · 🐷 Сегодня: <b>$0.00</b>`
  );
}

function getConnectionType() {
  if (!config.engineKey) return 'Не подключён';
  if (config.engine === 'claude') return 'Подписка Claude';
  if (config.engine === 'codex') return 'API OpenAI';
  return 'API';
}

// ── Главная клавиатура настроек ──

export function buildSettingsKeyboard() {
  const model = getCurrentModel();
  return new InlineKeyboard()
    .text('📡 Подключение: подписка', 'settings:connection')
    .row()
    .text('🔑 Переменные окружения', 'settings:env_vars')
    .row()
    .text(`🔒 Режим: 😈 ${currentMode}`, 'settings:mode')
    .row()
    .text(`🧠 Модель: ${model.name}`, 'settings:model')
    .row()
    .text('💰 Лимит: без ограничений', 'settings:limit')
    .row()
    .text(`🕐 Часовой пояс`, 'settings:timezone')
    .row()
    .text('⏰ Таймеры', 'settings:timers')
    .row()
    .text('⚙️ Дополнительно', 'settings:advanced')
    .row()
    .text('« Назад', 'menu:back');
}

// ── Обновление .env ──

function ensureEnvFile() {
  const envPath = join(config.dataDir, '.env');
  if (!existsSync(envPath)) {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(envPath, '# Jarvis environment\n');
  }
  return envPath;
}

function updateEnvFile(engineId, apiKey) {
  const envPath = ensureEnvFile();

  let content = readFileSync(envPath, 'utf8');
  const keyInfo = ENGINE_KEY_MAP[engineId];
  if (!keyInfo) return false;

  if (content.match(/^ENGINE=.*/m)) {
    content = content.replace(/^ENGINE=.*/m, `ENGINE=${engineId}`);
  } else {
    content += `\nENGINE=${engineId}`;
  }

  if (content.match(new RegExp(`^${keyInfo.env}=.*`, 'm'))) {
    content = content.replace(new RegExp(`^${keyInfo.env}=.*`, 'm'), `${keyInfo.env}=${apiKey}`);
  } else {
    content += `\n${keyInfo.env}=${apiKey}`;
  }

  writeFileSync(envPath, content);
  return true;
}

function updateEnvVar(key, value) {
  const envPath = ensureEnvFile();
  let content = readFileSync(envPath, 'utf8');
  if (content.match(new RegExp(`^${key}=.*`, 'm'))) {
    content = content.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  writeFileSync(envPath, content);
  return true;
}

// ── Переменные окружения: UI ──

// Все системные переменные — не показываем в пользовательском списке
const SYSTEM_VARS = new Set([
  'ENGINE', 'BOT_TOKEN', 'AGENT_NAME', 'ADMIN_ID',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
  'IIA_WORKSPACE_DIR', 'IIA_SESSION_DIR', 'NODE_ENV',
  'SYNC_KEY', 'SYNC_URL', 'CLAUDE_MODEL',
]);

function getUserEnvVars() {
  const envPath = join(config.dataDir, '.env');
  if (!existsSync(envPath)) return [];
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const vars = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (SYSTEM_VARS.has(key)) continue;
    vars.push({ key, value: val });
  }
  return vars;
}

function deleteEnvVar(key) {
  const envPath = join(config.dataDir, '.env');
  if (!existsSync(envPath)) return;
  let content = readFileSync(envPath, 'utf8');
  content = content.replace(new RegExp(`^${key}=.*\\n?`, 'm'), '');
  writeFileSync(envPath, content);
  delete process.env[key];
}

function maskValue(val) {
  return val.length > 4 ? '…' + val.slice(-4) : '••••';
}

export function buildEnvVarsMessage() {
  const userVars = getUserEnvVars();
  const catalogVarNames = new Set(SERVICE_CATALOG.flatMap(s => s.vars));
  let text = `🔑 <b>Переменные окружения</b>\n\n`;

  // ── [системные] ──
  const sysEntries = [];
  for (const key of SYSTEM_DISPLAY_VARS) {
    const val = process.env[key];
    if (val) sysEntries.push({ key, value: val });
  }
  if (sysEntries.length > 0) {
    text += `[системные]\n`;
    for (const v of sysEntries) {
      text += `${v.key}: ${maskValue(v.value)} 🔒\n`;
    }
    text += `\n`;
  }

  // ── [подключены] ──
  if (userVars.length > 0) {
    text += `[подключены]\n`;
    // Сервисы из каталога
    for (const svc of SERVICE_CATALOG) {
      const connected = svc.vars.filter(v => userVars.some(uv => uv.key === v));
      if (connected.length === 0) continue;

      if (svc.vars.length > 1) {
        // Мульти-ключевой сервис: "Railway: 1 из 2 ключей"
        text += `${svc.label.split(' (')[0]}: ${connected.length} из ${svc.vars.length} ключей\n`;
      } else {
        const v = userVars.find(uv => uv.key === svc.vars[0]);
        text += `${svc.vars[0]}: ${maskValue(v.value)}\n`;
      }
      if (svc.desc) {
        text += `  └ <i>${svc.desc}</i>\n`;
      }
    }
    // Кастомные переменные (не в каталоге)
    const customVars = userVars.filter(v => !catalogVarNames.has(v.key));
    for (const v of customVars) {
      text += `${v.key}: ${maskValue(v.value)}\n`;
    }
  } else {
    text += `Пусто. Добавь переменные — агент сможет использовать их для работы с внешними сервисами.`;
  }

  // ── Клавиатура ──
  const kb = new InlineKeyboard();

  // Подключённые сервисы из каталога
  for (const svc of SERVICE_CATALOG) {
    const connected = svc.vars.filter(v => process.env[v]);
    if (connected.length > 0) {
      kb.text(`${svc.label} ☑️`, `settings:svc:${svc.id}`).row();
    }
  }

  // Кастомные переменные (не в каталоге) — показываем с ☑️
  const customVars = userVars.filter(v => !catalogVarNames.has(v.key));
  for (const v of customVars) {
    kb.text(`${v.key} ☑️`, `settings:svc_custom:${v.key}`).row();
  }

  // Предложения — сервисы, которые ещё не подключены
  for (const svc of SUGGESTED_SERVICES) {
    const connected = svc.vars.some(v => process.env[v]);
    if (!connected) {
      kb.text(`➕ ${svc.label}`, `settings:svc_add:${svc.id}`).row();
    }
  }

  kb.text('✏️ ВПИСАТЬ СВОЮ', 'settings:env_add').row();
  kb.text('« Назад', 'settings:back');

  return [text, { parse_mode: 'HTML', reply_markup: kb }];
}

// ── Обработка callback-кнопок ──

export async function handleSettingsCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;

  // ── Подключение ──
  if (data === 'settings:connection') {
    const model = getCurrentModel();
    const connType = getConnectionType();
    const engine = getEngineInfo(config.engine);
    let text = `<b>📡 Подключение</b>\n\n`;
    text += `Тип: <b>${connType}</b>\n`;
    text += `Движок: <b>${engine.name}</b>\n`;
    text += `Модель: <b>${model.emoji} ${model.name}</b>\n`;
    text += `Статус: ${config.engineKey ? '✅ подключён' : '❌ не подключён'}\n\n`;
    if (!config.engineKey) {
      text += `Для подключения используй кнопку «Модель» в настройках.`;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('« Назад', 'settings:back'),
    });
    return;
  }

  // ── Переменные окружения ──
  if (data === 'settings:env_vars') {
    await ctx.answerCallbackQuery();
    await ctx.reply(...buildEnvVarsMessage());
    return;
  }

  if (data === 'settings:env_add') {
    waitingInput.set(chatId, { field: 'envVarName' });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Введите имя переменной (например <code>SERPER_API_KEY</code>):`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'settings:env_vars'),
      }
    );
    return;
  }

  // ── Клик по подключённому сервису из каталога ──
  if (data.startsWith('settings:svc:')) {
    const svcId = data.replace('settings:svc:', '');
    const svc = SERVICE_CATALOG.find(s => s.id === svcId);
    if (!svc) { await ctx.answerCallbackQuery({ text: 'Неизвестный сервис' }); return; }

    const vars = getUserEnvVars();
    const kb = new InlineKeyboard();
    let text = `<b>${svc.label}</b>\n`;
    if (svc.desc) text += `<i>${svc.desc}</i>\n`;
    text += `\n`;

    for (const varName of svc.vars) {
      const v = vars.find(uv => uv.key === varName);
      if (v) {
        text += `<code>${varName}</code> = ${maskValue(v.value)} ✅\n`;
        kb.text(`❌ ${varName}`, `settings:env_del:${varName}`).row();
      } else {
        text += `<code>${varName}</code> — не задана\n`;
        kb.text(`➕ ${varName}`, `settings:svc_var_add:${varName}`).row();
      }
    }

    kb.text('« Назад', 'settings:env_vars');
    await ctx.answerCallbackQuery();
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  // ── Клик по кастомной переменной ──
  if (data.startsWith('settings:svc_custom:')) {
    const varName = data.replace('settings:svc_custom:', '');
    const vars = getUserEnvVars();
    const v = vars.find(uv => uv.key === varName);
    if (!v) { await ctx.answerCallbackQuery({ text: 'Переменная не найдена' }); return; }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<code>${varName}</code> = ${maskValue(v.value)}`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(`❌ Удалить`, `settings:env_del:${varName}`)
          .text('« Назад', 'settings:env_vars'),
      }
    );
    return;
  }

  // ── Добавить предложенный сервис ──
  if (data.startsWith('settings:svc_add:')) {
    const svcId = data.replace('settings:svc_add:', '');
    const svc = SUGGESTED_SERVICES.find(s => s.id === svcId);
    if (!svc) { await ctx.answerCallbackQuery({ text: 'Неизвестный сервис' }); return; }

    const varName = svc.vars[0];
    waitingInput.set(chatId, { field: 'envVarValue', varName });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>${svc.label}</b>\n\n` +
      `Введи значение для <code>${varName}</code>:` +
      (svc.hint ? `\n\n💡 ${svc.hint}` : ''),
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── Добавить конкретную переменную сервиса ──
  if (data.startsWith('settings:svc_var_add:')) {
    const varName = data.replace('settings:svc_var_add:', '');
    waitingInput.set(chatId, { field: 'envVarValue', varName });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Введи значение для <code>${varName}</code>:`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (data.startsWith('settings:env_del:')) {
    const varName = data.replace('settings:env_del:', '');
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Удалить переменную <code>${varName}</code>?`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('Да, удалить', `settings:env_del_ok:${varName}`)
          .text('Отмена', 'settings:env_vars'),
      }
    );
    return;
  }

  if (data.startsWith('settings:env_del_ok:')) {
    const varName = data.replace('settings:env_del_ok:', '');
    deleteEnvVar(varName);
    await ctx.answerCallbackQuery({ text: `${varName} удалена` });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(...buildEnvVarsMessage());
    return;
  }

  // ── Режим ──
  if (data === 'settings:mode') {
    const kb = new InlineKeyboard();
    for (const m of MODES) {
      const mark = m === currentMode ? ' ✓' : '';
      kb.text(`${m}${mark}`, `settings:mode_pick:${m}`);
    }
    kb.row().text('« Назад', 'settings:back');
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>Режим работы</b>\n\nТекущий: <b>${currentMode}</b>`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    return;
  }

  if (data.startsWith('settings:mode_pick:')) {
    const mode = data.split(':')[2];
    if (MODES.includes(mode)) {
      currentMode = mode;
    }
    await ctx.answerCallbackQuery({ text: `Режим: ${currentMode}` });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(getSettingsText(), {
      parse_mode: 'HTML',
      reply_markup: buildSettingsKeyboard(),
    });
    return;
  }

  // ── Модель ──
  if (data === 'settings:model') {
    const current = getCurrentModel();
    const kb = new InlineKeyboard();
    for (const m of CLAUDE_MODELS) {
      const mark = m.id === current.id ? ' ✓' : '';
      kb.text(`${m.emoji} ${m.name}${mark}`, `settings:model_pick:${m.id}`).row();
    }
    // Переключение движка — отдельно
    kb.text('🔧 Сменить движок', 'settings:engine').row();
    kb.text('« Назад', 'settings:back');
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>Модель</b>\n\n` +
      `Текущая: <b>${current.emoji} ${current.name}</b>\n\n` +
      CLAUDE_MODELS.map(m =>
        `${m.id === current.id ? '→ ' : '  '}${m.emoji} <b>${m.name}</b>`
      ).join('\n'),
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }

  if (data.startsWith('settings:model_pick:')) {
    const modelId = data.split(':')[2];
    const model = CLAUDE_MODELS.find(m => m.id === modelId);
    if (!model) { await ctx.answerCallbackQuery({ text: 'Неизвестная модель' }); return; }

    updateEnvVar('CLAUDE_MODEL', model.modelId);
    process.env.CLAUDE_MODEL = model.modelId;
    await ctx.answerCallbackQuery({ text: `Модель: ${model.name}` });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(getSettingsText(), {
      parse_mode: 'HTML',
      reply_markup: buildSettingsKeyboard(),
    });
    return;
  }

  // ── Движок (под-меню модели) ──
  if (data === 'settings:engine') {
    const current = config.engine;
    const kb = new InlineKeyboard();
    const engines = listEngines();
    for (const e of engines) {
      const mark = e.id === current ? ' ✓' : '';
      kb.text(`${e.name}${mark}`, `settings:engine_pick:${e.id}`);
    }
    kb.row().text('« Назад', 'settings:model');
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>Движок</b>\n\n` +
      `Текущий: <b>${getEngineInfo(current).name}</b>\n\n` +
      engines.map(e => `${e.id === current ? '→ ' : '  '}<b>${e.name}</b> — ${e.plans}`).join('\n'),
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }

  if (data.startsWith('settings:engine_pick:')) {
    const engineId = data.split(':')[2];
    const keyInfo = ENGINE_KEY_MAP[engineId];
    if (!keyInfo) {
      await ctx.answerCallbackQuery({ text: 'Неизвестный движок' });
      return;
    }
    if (engineId === config.engine && config.engineKey) {
      await ctx.answerCallbackQuery({ text: 'Уже используется' });
      return;
    }
    const existingKey = process.env[keyInfo.env];
    if (existingKey) {
      const ok = updateEnvFile(engineId, existingKey);
      if (ok) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `Переключаюсь на <b>${getEngineInfo(engineId).name}</b> — ключ уже есть. Перезапускаюсь...`,
          { parse_mode: 'HTML' }
        );
        setTimeout(() => process.exit(0), 1500);
        return;
      }
    }
    waitingInput.set(chatId, { field: 'engineKey', engineId });
    await ctx.answerCallbackQuery();
    await ctx.reply(keyInfo.guide, { parse_mode: 'HTML' });
    return;
  }

  // ── Лимит ──
  if (data === 'settings:limit') {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>💰 Лимит расходов</b>\n\n` +
      `Текущий: <b>без ограничений</b>\n` +
      `Сегодня: <b>$0.00</b>\n\n` +
      `Настройка лимитов пока в разработке. Сейчас расходы не ограничены.`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('« Назад', 'settings:back'),
      }
    );
    return;
  }

  // ── Часовой пояс ──
  if (data === 'settings:timezone') {
    const zones = ['Moscow', 'UTC', 'Europe/London', 'US/Eastern', 'US/Pacific', 'Asia/Tokyo'];
    const kb = new InlineKeyboard();
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const mark = z === timezone ? ' ✓' : '';
      kb.text(`${z}${mark}`, `settings:tz_pick:${z}`);
      if ((i + 1) % 2 === 0) kb.row();
    }
    kb.row().text('« Назад', 'settings:back');
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>Часовой пояс</b>\n\nТекущий: <b>${timezone}</b>`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    return;
  }

  if (data.startsWith('settings:tz_pick:')) {
    timezone = data.replace('settings:tz_pick:', '');
    await ctx.answerCallbackQuery({ text: `Часовой пояс: ${timezone}` });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(getSettingsText(), {
      parse_mode: 'HTML',
      reply_markup: buildSettingsKeyboard(),
    });
    return;
  }

  // ── Таймеры ──
  if (data === 'settings:timers') {
    await ctx.answerCallbackQuery();
    const schedulesPath = join(config.dataDir, 'schedules.json');
    let schedules = [];
    if (existsSync(schedulesPath)) {
      try { schedules = JSON.parse(readFileSync(schedulesPath, 'utf8')); } catch { /* ignore */ }
    }

    const kb = new InlineKeyboard();
    let timersText;
    if (schedules.length === 0) {
      timersText = 'Нет таймеров.\n\nСоздать можно командой в чате, например:\n<code>Создай таймер "Утренний отчёт" каждый день в 9:00</code>';
    } else {
      timersText = schedules.map((s, i) => {
        const status = s.enabled ? '✅' : '⏸';
        const time = s.hour !== undefined ? `${String(s.hour).padStart(2, '0')}:${String(s.minute ?? 0).padStart(2, '0')}` : '';
        return `${status} <b>${s.name || 'Без имени'}</b> — ${s.type} ${time}`;
      }).join('\n');
      // Кнопки управления
      for (const s of schedules) {
        const label = s.enabled ? `⏸ ${s.name}` : `▶️ ${s.name}`;
        kb.text(label, `settings:timer_toggle:${s.id}`);
        kb.text(`🗑`, `settings:timer_del:${s.id}`);
        kb.row();
      }
    }
    kb.text('« Назад', 'settings:back');
    await ctx.reply(`<b>⏰ Таймеры</b>\n\n${timersText}`, { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  if (data.startsWith('settings:timer_toggle:')) {
    const timerId = data.replace('settings:timer_toggle:', '');
    const schedulesPath = join(config.dataDir, 'schedules.json');
    try {
      const schedules = JSON.parse(readFileSync(schedulesPath, 'utf8'));
      const timer = schedules.find(s => s.id === timerId);
      if (timer) {
        timer.enabled = !timer.enabled;
        writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2));
        await ctx.answerCallbackQuery({ text: timer.enabled ? 'Включён' : 'Выключен' });
      }
    } catch { /* ignore */ }
    await ctx.deleteMessage().catch(() => {});
    // Рекурсивно показать обновлённый список
    ctx.callbackQuery.data = 'settings:timers';
    return handleSettingsCallback(ctx);
  }

  if (data.startsWith('settings:timer_del:')) {
    const timerId = data.replace('settings:timer_del:', '');
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Удалить таймер?`,
      {
        reply_markup: new InlineKeyboard()
          .text('Да, удалить', `settings:timer_del_ok:${timerId}`)
          .text('Отмена', 'settings:timers'),
      }
    );
    return;
  }

  if (data.startsWith('settings:timer_del_ok:')) {
    const timerId = data.replace('settings:timer_del_ok:', '');
    const schedulesPath = join(config.dataDir, 'schedules.json');
    try {
      let schedules = JSON.parse(readFileSync(schedulesPath, 'utf8'));
      schedules = schedules.filter(s => s.id !== timerId);
      writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2));
      await ctx.answerCallbackQuery({ text: 'Таймер удалён' });
    } catch { /* ignore */ }
    await ctx.deleteMessage().catch(() => {});
    ctx.callbackQuery.data = 'settings:timers';
    return handleSettingsCallback(ctx);
  }

  // ── Дополнительно ──
  if (data === 'settings:advanced') {
    const profile = getProfile();
    const trust = getTrustState();
    const kb = new InlineKeyboard()
      .text('👤 Моё имя', 'settings:owner_name')
      .text('🤖 Имя агента', 'settings:agent_name')
      .row()
      .text('🔄 Перезагрузить', 'settings:restart')
      .text('⚠️ Сброс онбординга', 'settings:reset')
      .row()
      .text('« Назад', 'settings:back');

    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>Дополнительно</b>\n\n` +
      `👤 Владелец: <b>${profile.ownerName || '(не задано)'}</b>\n` +
      `🤖 Агент: <b>${getAgentName()}</b>\n` +
      `🔒 Trust: ${trust.level} — ${getTrustName()} (${trust.sessions} сессий)\n` +
      `📅 Создан: ${profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('ru') : '—'}`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }

  // ── Имя владельца ──
  if (data === 'settings:owner_name') {
    waitingInput.set(chatId, { field: 'ownerName' });
    await ctx.answerCallbackQuery();
    await ctx.reply('Напиши своё имя:');
    return;
  }

  // ── Имя агента ──
  if (data === 'settings:agent_name') {
    waitingInput.set(chatId, { field: 'agentName' });
    await ctx.answerCallbackQuery();
    await ctx.reply('Напиши новое имя агента:');
    return;
  }

  // ── Перезагрузка ──
  if (data === 'settings:restart') {
    await ctx.answerCallbackQuery();
    await ctx.reply('🔄 Перезагружаюсь...');
    setTimeout(() => process.exit(0), 1000);
    return;
  }

  // ── Сброс ──
  if (data === 'settings:reset') {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '⚠️ Сбросить онбординг? Бот забудет кто ты.',
      {
        reply_markup: new InlineKeyboard()
          .text('Да, сбросить', 'settings:reset_confirm')
          .text('Отмена', 'settings:close'),
      }
    );
    return;
  }

  if (data === 'settings:reset_confirm') {
    resetOnboarding();
    await ctx.answerCallbackQuery({ text: 'Онбординг сброшен' });
    await ctx.reply('Готово. Напиши /start чтобы начать заново.');
    return;
  }

  // ── Назад (к главным настройкам) ──
  if (data === 'settings:back') {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(getSettingsText(), {
      parse_mode: 'HTML',
      reply_markup: buildSettingsKeyboard(),
    });
    return;
  }

  // ── Закрыть ──
  if (data === 'settings:close') {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    return;
  }
}

// ── Обработка текстового ввода для настроек ──

export function handleSettingsInput(chatId, text) {
  const waiting = waitingInput.get(chatId);
  if (!waiting) return null;

  const trimmed = text.trim();

  if (waiting.field === 'ownerName') {
    if (!trimmed || trimmed.length > 50) {
      waitingInput.delete(chatId);
      return { error: 'Имя должно быть от 1 до 50 символов.' };
    }
    setOwnerName(trimmed);
    waitingInput.delete(chatId);
    return { success: `Запомнил! Теперь ты — <b>${trimmed}</b>.` };
  }

  if (waiting.field === 'agentName') {
    if (!trimmed || trimmed.length > 50) {
      waitingInput.delete(chatId);
      return { error: 'Имя должно быть от 1 до 50 символов.' };
    }
    setAgentName(trimmed);
    waitingInput.delete(chatId);
    return { success: `Теперь меня зовут <b>${trimmed}</b>.` };
  }

  if (waiting.field === 'engineKey') {
    // Убираем ВСЕ пробельные символы (переносы строк, пробелы) — Telegram может разбить длинный токен
    const cleanToken = trimmed.replace(/\s+/g, '');
    if (!cleanToken || cleanToken.length < 10) {
      waitingInput.delete(chatId);
      return { error: 'Ключ слишком короткий. Попробуй ещё раз через Настройки → Модель.' };
    }
    const engineId = waiting.engineId;

    // OAuth-токен подписки Claude (sk-ant-oat...) → отдельная переменная
    if (engineId === 'claude' && cleanToken.startsWith('sk-ant-oat')) {
      console.log(`[settings] OAuth token received: ${cleanToken.length} chars, starts: ${cleanToken.slice(0, 15)}...`);
      const ok = updateEnvVar('CLAUDE_CODE_OAUTH_TOKEN', cleanToken);
      const ok2 = updateEnvVar('ENGINE', engineId);
      waitingInput.delete(chatId);
      if (ok && ok2) {
        return {
          success: `Токен подписки Claude Max сохранён (${cleanToken.length} символов). Переключаюсь на <b>Claude Code</b>. Перезапускаюсь...`,
          restart: true,
        };
      }
      return { error: 'Не удалось обновить .env.' };
    }

    // Обычный API-ключ — тоже логируем длину
    console.log(`[settings] API key received: ${cleanToken.length} chars`);

    // Обычный API-ключ
    const ok = updateEnvFile(engineId, cleanToken);
    waitingInput.delete(chatId);
    if (ok) {
      return {
        success: `Движок переключён на <b>${getEngineInfo(engineId).name}</b>. Перезапускаюсь...`,
        restart: true,
      };
    }
    return { error: 'Не удалось обновить .env. Проверь файл ~/.jarvis/.env' };
  }

  // ── Добавление переменной окружения: шаг 1 — имя ──
  if (waiting.field === 'envVarName') {
    const name = trimmed.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!name || name.length < 2) {
      waitingInput.delete(chatId);
      return { error: 'Имя переменной должно быть минимум 2 символа (латиница, цифры, _).' };
    }
    if (SYSTEM_VARS.has(name)) {
      waitingInput.delete(chatId);
      return { error: `<code>${name}</code> — системная переменная. Используй соответствующую кнопку в настройках.` };
    }
    waitingInput.set(chatId, { field: 'envVarValue', varName: name });
    return { success: `Имя: <code>${name}</code>\n\nТеперь введи <b>значение</b>:` };
  }

  // ── Добавление переменной окружения: шаг 2 — значение ──
  if (waiting.field === 'envVarValue') {
    const value = trimmed.replace(/\s+/g, '');
    if (!value) {
      waitingInput.delete(chatId);
      return { error: 'Значение не может быть пустым.' };
    }
    const varName = waiting.varName;
    const ok = updateEnvVar(varName, value);
    process.env[varName] = value;
    waitingInput.delete(chatId);
    if (ok) {
      const masked = value.length > 4 ? '…' + value.slice(-4) : '••••';
      return {
        success: `✅ Сохранено: <code>${varName}</code> = ${masked}\n\nАгент может использовать через <code>$${varName}</code>.`,
        envVarsUpdated: true,
      };
    }
    return { error: 'Не удалось сохранить. Проверь файл ~/.jarvis/.env' };
  }

  waitingInput.delete(chatId);
  return null;
}
