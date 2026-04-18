// Персистентный стейт: сессии, расходы, режим, authMode
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { config } from './config.js';

const STATE_PATH = join(config.dataDir, 'state.json');

const DEFAULTS = {
  permissionMode: 'auto',    // auto | control | plan
  sessionId: null,            // CLI session ID для --resume
  authMode: null,             // subscription | api-key (автодетект)
  costHistory: {},            // { "2026-04-17": 1.23 }
  dailySpendLimit: 50,        // USD, 0 = без лимита
  costPaused: false,          // автопауза при достижении лимита
  lastCostAlert: null,        // дата последнего 80% alert
  activeProject: null,        // текущий проект
  timezone: 'Europe/Moscow',  // часовой пояс
};

// ── Загрузка / сохранение ──

let _cache = null;

export function loadState() {
  if (_cache) return _cache;
  try {
    const raw = readFileSync(STATE_PATH, 'utf-8');
    _cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    _cache = { ...DEFAULTS };
  }
  return _cache;
}

export function saveState(state) {
  _cache = state;
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, STATE_PATH);
}

// ── Хелперы ──

function todayKey(tz) {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ── Permission mode ──

export function getPermissionMode() {
  return loadState().permissionMode || 'auto';
}

export function setPermissionMode(mode) {
  const valid = ['auto', 'control', 'plan'];
  if (!valid.includes(mode)) return;
  const state = loadState();
  state.permissionMode = mode;
  state.sessionId = null; // сброс сессии при смене режима
  saveState(state);
}

// ── Session ID ──

export function getSessionId() {
  return loadState().sessionId;
}

export function setSessionId(id) {
  const state = loadState();
  state.sessionId = id;
  saveState(state);
}

// ── Auth mode ──

export function detectAuthMode() {
  const state = loadState();

  // Авто-детект subscription-токена
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (oauthToken) {
    if (state.authMode !== 'subscription') {
      state.authMode = 'subscription';
      saveState(state);
    }
    return 'subscription';
  }

  // Проверяем, не лежит ли subscription-токен в ANTHROPIC_API_KEY
  if (apiKey && /^sk-ant-(?:oat|ort)\d{2}-/.test(apiKey)) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = apiKey;
    delete process.env.ANTHROPIC_API_KEY;
    state.authMode = 'subscription';
    saveState(state);
    console.log('[state] Subscription token detected in ANTHROPIC_API_KEY, migrated to CLAUDE_CODE_OAUTH_TOKEN');
    return 'subscription';
  }

  if (apiKey) {
    if (state.authMode !== 'api-key') {
      state.authMode = 'api-key';
      saveState(state);
    }
    return 'api-key';
  }

  return state.authMode;
}

// ── Cost tracking ──

const COST_HISTORY_DAYS = 30;

export function recordCost(usd) {
  if (!usd || usd <= 0) return { paused: false, warning: false };

  const state = loadState();
  if (!state.costHistory) state.costHistory = {};
  if (state.dailySpendLimit === undefined) state.dailySpendLimit = 50;

  const today = todayKey(state.timezone);
  state.costHistory[today] = (state.costHistory[today] ?? 0) + usd;

  // Очистка старых записей (>30 дней)
  const days = Object.keys(state.costHistory).sort();
  while (days.length > COST_HISTORY_DAYS) {
    delete state.costHistory[days.shift()];
  }

  let paused = false;
  let warning = false;

  if (state.dailySpendLimit > 0) {
    const ratio = state.costHistory[today] / state.dailySpendLimit;
    if (ratio >= 1 && !state.costPaused) {
      state.costPaused = true;
      paused = true;
    } else if (ratio >= 0.8 && state.lastCostAlert !== today) {
      state.lastCostAlert = today;
      warning = true;
    }
  }

  saveState(state);
  return { paused, warning };
}

export function getTodayCost() {
  const state = loadState();
  const today = todayKey(state.timezone);
  return state.costHistory?.[today] ?? 0;
}

export function getCostHistory() {
  const state = loadState();
  return state.costHistory || {};
}

export function getDailyLimit() {
  return loadState().dailySpendLimit ?? 50;
}

export function setDailyLimit(usd) {
  const state = loadState();
  state.dailySpendLimit = Math.max(0, usd);
  // Снимаем паузу если лимит увеличен
  if (usd > 0 && state.costPaused) {
    const today = todayKey(state.timezone);
    const spent = state.costHistory?.[today] ?? 0;
    if (spent < usd) state.costPaused = false;
  }
  saveState(state);
}

export function isCostPaused() {
  const state = loadState();
  if (!state.costPaused) return false;
  // Авто-сброс паузы на новый день (расход обнулился)
  if (state.dailySpendLimit > 0) {
    const today = todayKey(state.timezone);
    const spent = state.costHistory?.[today] ?? 0;
    if (spent < state.dailySpendLimit) {
      state.costPaused = false;
      saveState(state);
      return false;
    }
  }
  return true;
}

export function unpauseCost() {
  const state = loadState();
  state.costPaused = false;
  saveState(state);
}

// ── Active project ──

export function getActiveProject() {
  return loadState().activeProject;
}

export function setActiveProject(name) {
  const state = loadState();
  state.activeProject = name;
  saveState(state);
}

// ── Timezone ──

export function getTimezone() {
  return loadState().timezone || 'Europe/Moscow';
}

export function setTimezone(tz) {
  const state = loadState();
  state.timezone = tz;
  saveState(state);
}
