// Меню настроек — inline-клавиатура в Telegram
import { InlineKeyboard } from 'grammy';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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

// ── Карта ключей по движкам ──

const ENGINE_KEY_MAP = {
  claude: {
    env: 'ANTHROPIC_API_KEY',
    hint: 'Anthropic API Key (sk-ant-...)',
    guide:
      `<b>Как получить ключ Claude Code:</b>\n\n` +
      `<b>Вариант A — API credits:</b>\n` +
      `1. Зайди на console.anthropic.com\n` +
      `2. Зарегистрируйся / войди\n` +
      `3. Settings → API Keys → Create Key\n` +
      `4. Скопируй ключ (начинается с <code>sk-ant-</code>)\n` +
      `5. Пополни баланс (Settings → Billing)\n\n` +
      `<b>Вариант B — подписка Claude Max ($100/мес):</b>\n` +
      `1. Зайди на claude.ai → Settings → Subscription\n` +
      `2. Подключи Claude Max\n` +
      `3. Ключ не нужен — Claude Code авторизуется через <code>claude login</code>\n\n` +
      `Если у тебя API credits — отправь ключ сюда:`,
  },
  codex: {
    env: 'OPENAI_API_KEY',
    hint: 'OpenAI API Key (sk-...)',
    guide:
      `<b>Как получить ключ Codex:</b>\n\n` +
      `<b>Вариант A — API key:</b>\n` +
      `1. Зайди на platform.openai.com\n` +
      `2. Зарегистрируйся / войди\n` +
      `3. API Keys → Create new secret key\n` +
      `4. Скопируй ключ (начинается с <code>sk-</code>)\n` +
      `5. Пополни баланс (Settings → Billing)\n\n` +
      `<b>Вариант B — подписка ChatGPT Plus ($20/мес):</b>\n` +
      `1. Зайди на chatgpt.com → Settings → Subscription\n` +
      `2. Подключи Plus или Pro\n` +
      `3. Codex работает через подписку без отдельного ключа\n\n` +
      `Если у тебя API key — отправь его сюда:`,
  },
};

// ── Режим работы ──

const MODES = ['авто', 'ручной', 'plan'];
let currentMode = 'авто';

// ── Часовой пояс ──

let timezone = 'Moscow';

// ── Текст карточки настроек (как в reference) ──

export function getSettingsText() {
  const engine = getEngineInfo(config.engine);
  const connected = config.engineKey ? '✅' : '❌ не подключён';
  const modelStatus = config.engineKey ? engine.name : `${engine.name} (${connected})`;
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
  const engine = getEngineInfo(config.engine);
  return new InlineKeyboard()
    .text('📡 Подключение: подписка', 'settings:connection')
    .row()
    .text('🔑 Переменные окружения', 'settings:env_vars')
    .row()
    .text(`🔒 Режим: 😈 ${currentMode}`, 'settings:mode')
    .row()
    .text(`🧠 Модель: ${engine.name}${config.engineKey ? '' : ' ❌'}`, 'settings:engine')
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

function updateEnvFile(engineId, apiKey) {
  const envPath = join(config.dataDir, '.env');
  if (!existsSync(envPath)) return false;

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

// ── Обработка callback-кнопок ──

export async function handleSettingsCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;

  // ── Подключение ──
  if (data === 'settings:connection') {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>Подключение</b>\n\n` +
      `Текущее: <b>${getConnectionType()}</b>\n\n` +
      `Для смены движка используй кнопку «Модель» в настройках.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── Переменные окружения ──
  if (data === 'settings:env_vars') {
    await ctx.answerCallbackQuery();
    const envPath = join(config.dataDir, '.env');
    let vars = '(файл .env не найден)';
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf8').split('\n')
        .filter(l => l.trim() && !l.startsWith('#'))
        .map(l => {
          const eq = l.indexOf('=');
          if (eq === -1) return l;
          const key = l.slice(0, eq);
          const val = l.slice(eq + 1);
          // Маскируем значения
          const masked = val.length > 4 ? '…' + val.slice(-4) : '****';
          return `${key}=${masked}`;
        });
      vars = lines.join('\n') || '(пусто)';
    }
    await ctx.reply(
      `<b>Переменные окружения</b>\n\n<pre>${vars}</pre>\n\n` +
      `Редактировать: <code>~/.jarvis/.env</code>`,
      { parse_mode: 'HTML' }
    );
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

  // ── Движок/Модель ──
  if (data === 'settings:engine') {
    const current = config.engine;
    const kb = new InlineKeyboard();
    const engines = listEngines();
    for (const e of engines) {
      const mark = e.id === current ? ' ✓' : '';
      kb.text(`${e.name}${mark}`, `settings:engine_pick:${e.id}`);
    }
    kb.row().text('« Назад', 'settings:back');
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>Выбери движок</b>\n\n` +
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
    // Проверяем — может ключ уже есть в .env
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
    // Ключа нет — показываем инструкцию
    waitingInput.set(chatId, { field: 'engineKey', engineId });
    await ctx.answerCallbackQuery();
    await ctx.reply(keyInfo.guide, { parse_mode: 'HTML' });
    return;
  }

  // ── Лимит ──
  if (data === 'settings:limit') {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `<b>Лимит расходов</b>\n\n` +
      `Текущий: <b>без ограничений</b>\n\n` +
      `Функция лимитов пока в разработке.`,
      { parse_mode: 'HTML' }
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
    let timersText = 'Нет таймеров.';
    if (existsSync(schedulesPath)) {
      try {
        const schedules = JSON.parse(readFileSync(schedulesPath, 'utf8'));
        if (schedules.length > 0) {
          timersText = schedules.map((s, i) =>
            `${i + 1}. <b>${s.name || 'Без имени'}</b> — ${s.type}, ${s.enabled ? 'активен' : 'выключен'}`
          ).join('\n');
        }
      } catch { /* ignore */ }
    }
    await ctx.reply(`<b>Таймеры</b>\n\n${timersText}`, { parse_mode: 'HTML' });
    return;
  }

  // ── Дополнительно ──
  if (data === 'settings:advanced') {
    const profile = getProfile();
    const trust = getTrustState();
    const kb = new InlineKeyboard()
      .text('👤 Моё имя', 'settings:owner_name')
      .text('🤖 Имя агента', 'settings:agent_name')
      .row()
      .text('🔄 Сброс онбординга', 'settings:reset')
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
    if (!trimmed || trimmed.length < 10) {
      waitingInput.delete(chatId);
      return { error: 'Ключ слишком короткий. Попробуй ещё раз через Настройки → Модель.' };
    }
    const engineId = waiting.engineId;
    const ok = updateEnvFile(engineId, trimmed);
    waitingInput.delete(chatId);
    if (ok) {
      return {
        success: `Движок переключён на <b>${getEngineInfo(engineId).name}</b>. Перезапускаюсь...`,
        restart: true,
      };
    }
    return { error: 'Не удалось обновить .env. Проверь файл ~/.jarvis/.env' };
  }

  waitingInput.delete(chatId);
  return null;
}
