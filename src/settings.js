// Меню настроек — inline-клавиатура в Telegram
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { getProfile, setOwnerName, setAgentName, resetOnboarding, getAgentName, getOwnerName } from './onboarding.js';
import { getEngineInfo } from './engine.js';
import { getTrustState, getTrustName } from './trust.js';

// ── Состояние ожидания ввода ──

const waitingInput = new Map(); // chatId → { field: 'ownerName' | 'agentName' }

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
    .text('⚙️ Статус', 'settings:status')
    .text('🔄 Сброс', 'settings:reset')
    .row()
    .text('✖ Закрыть', 'settings:close');
}

export function getSettingsText() {
  const profile = getProfile();
  const engine = getEngineInfo(config.engine);
  return (
    `<b>Настройки</b>\n\n` +
    `👤 Владелец: <b>${profile.ownerName || '(не задано)'}</b>\n` +
    `🤖 Агент: <b>${profile.agentName || config.agentName}</b>\n` +
    `⚙️ Движок: ${engine.name}\n`
  );
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

  if (data === 'settings:status') {
    const trust = getTrustState();
    const engine = getEngineInfo(config.engine);
    const profile = getProfile();
    const text =
      `<b>Статус</b>\n\n` +
      `👤 Владелец: ${profile.ownerName || '(не задано)'}\n` +
      `🤖 Агент: ${getAgentName()}\n` +
      `⚙️ Движок: ${engine.name}\n` +
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
  if (!trimmed || trimmed.length > 50) {
    waitingInput.delete(chatId);
    return { error: 'Имя должно быть от 1 до 50 символов.' };
  }

  if (waiting.field === 'ownerName') {
    setOwnerName(trimmed);
    waitingInput.delete(chatId);
    return { success: `Запомнил! Теперь ты — <b>${trimmed}</b>.` };
  }

  if (waiting.field === 'agentName') {
    setAgentName(trimmed);
    waitingInput.delete(chatId);
    return { success: `Теперь меня зовут <b>${trimmed}</b>.` };
  }

  waitingInput.delete(chatId);
  return null;
}
