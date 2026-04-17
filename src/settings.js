// Меню настроек — inline-клавиатура в Telegram
import { InlineKeyboard } from 'grammy';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { getProfile, setOwnerName, setAgentName, resetOnboarding, getAgentName, getOwnerName } from './onboarding.js';
import { getEngineInfo, listEngines } from './engine.js';
import { getTrustState, getTrustName } from './trust.js';

// ── Состояние ожидания ввода ──

const waitingInput = new Map(); // chatId → { field, engineId? }

export function getWaitingInput(chatId) {
  return waitingInput.get(chatId) || null;
}

export function clearWaitingInput(chatId) {
  waitingInput.delete(chatId);
}

// ── Главное меню настроек ──

export function buildSettingsKeyboard() {
  return new InlineKeyboard()
    .text('👤 Моё имя', 'settings:owner_name')
    .text('🤖 Имя агента', 'settings:agent_name')
    .row()
    .text('🧠 Движок', 'settings:engine')
    .text('⚙️ Статус', 'settings:status')
    .row()
    .text('🔄 Сброс', 'settings:reset')
    .text('✖ Закрыть', 'settings:close');
}

export function getSettingsText() {
  const profile = getProfile();
  const engine = getEngineInfo(config.engine);
  return (
    `<b>Настройки</b>\n\n` +
    `👤 Владелец: <b>${profile.ownerName || '(не задано)'}</b>\n` +
    `🤖 Агент: <b>${profile.agentName || config.agentName}</b>\n` +
    `🧠 Движок: <b>${engine.name}</b>\n`
  );
}

// ── Карта ключей по движкам ──

const ENGINE_KEY_MAP = {
  claude: { env: 'ANTHROPIC_API_KEY', hint: 'Anthropic API Key (sk-ant-...)' },
  codex:  { env: 'OPENAI_API_KEY', hint: 'OpenAI API Key (sk-...)' },
  gemini: { env: 'GEMINI_API_KEY', hint: 'Gemini API Key (AIza...)' },
};

// ── Обновление .env ──

function updateEnvFile(engineId, apiKey) {
  const envPath = join(config.dataDir, '.env');
  if (!existsSync(envPath)) return false;

  let content = readFileSync(envPath, 'utf8');
  const keyInfo = ENGINE_KEY_MAP[engineId];
  if (!keyInfo) return false;

  // Обновляем ENGINE
  if (content.match(/^ENGINE=.*/m)) {
    content = content.replace(/^ENGINE=.*/m, `ENGINE=${engineId}`);
  } else {
    content += `\nENGINE=${engineId}`;
  }

  // Обновляем/добавляем ключ
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

  if (data === 'settings:owner_name') {
    waitingInput.set(chatId, { field: 'ownerName' });
    await ctx.answerCallbackQuery();
    await ctx.reply('Напиши своё имя:');
    return;
  }

  if (data === 'settings:agent_name') {
    waitingInput.set(chatId, { field: 'agentName' });
    await ctx.answerCallbackQuery();
    await ctx.reply('Напиши новое имя агента:');
    return;
  }

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

    if (engineId === config.engine) {
      await ctx.answerCallbackQuery({ text: 'Уже используется' });
      return;
    }

    waitingInput.set(chatId, { field: 'engineKey', engineId });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Для <b>${getEngineInfo(engineId).name}</b> нужен ключ.\n\n` +
      `Отправь <b>${keyInfo.hint}</b>:`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (data === 'settings:status') {
    const trust = getTrustState();
    const engine = getEngineInfo(config.engine);
    const profile = getProfile();
    const text =
      `<b>Статус</b>\n\n` +
      `👤 Владелец: ${profile.ownerName || '(не задано)'}\n` +
      `🤖 Агент: ${getAgentName()}\n` +
      `🧠 Движок: ${engine.name}\n` +
      `🔒 Trust: ${trust.level} — ${getTrustName()} (${trust.sessions} сессий)\n` +
      `📅 Создан: ${profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('ru') : '—'}`;
    await ctx.answerCallbackQuery();
    await ctx.reply(text, { parse_mode: 'HTML' });
    return;
  }

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

  if (data === 'settings:back') {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(getSettingsText(), {
      parse_mode: 'HTML',
      reply_markup: buildSettingsKeyboard(),
    });
    return;
  }

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
      return { error: 'Ключ слишком короткий. Попробуй ещё раз через /settings → Движок.' };
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
