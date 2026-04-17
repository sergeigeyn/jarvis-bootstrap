// Главное меню — inline-клавиатура после /start
import { InlineKeyboard } from 'grammy';
import { getAgentName, getOwnerName } from './onboarding.js';

// ── Главное меню (8 кнопок, 2 столбца) ──

export function buildMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('🆕 Новая сессия', 'menu:new_session')
    .text('📁 Проекты', 'menu:projects')
    .row()
    .text('💬 Сессии', 'menu:sessions')
    .text('🔧 Навыки', 'menu:skills')
    .row()
    .text('🖥 Сервер', 'menu:server')
    .text('🔌 MCP', 'menu:mcp')
    .row()
    .text('⚙️ Настройки', 'menu:settings')
    .text('📡 Мониторинг', 'menu:monitoring');
}

export function getMainMenuText() {
  return 'Готов. Пиши задачу или выбери действие.';
}

export function getReturningMenuText() {
  const owner = getOwnerName();
  return `С возвращением, <b>${owner}</b>! Пиши задачу или выбери действие.`;
}
