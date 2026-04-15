// Динамический trust level — агент «взрослеет» с опытом
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { config } from './config.js';
import { join } from 'path';

const TRUST_PATH = join(config.dataDir, 'trust.json');

// ── Пороги уровней ──

const THRESHOLDS = [
  { level: 0, name: 'новичок', minSessions: 0 },
  { level: 1, name: 'знакомый', minSessions: 11 },
  { level: 2, name: 'доверенный', minSessions: 51 },
];

// ── Состояние ──

let state = {
  sessions: 0,
  level: 0,
  firstSeen: new Date().toISOString().slice(0, 10),
  overridden: false,
};

// ── Загрузка/сохранение ──

function load() {
  if (existsSync(TRUST_PATH)) {
    try {
      state = { ...state, ...JSON.parse(readFileSync(TRUST_PATH, 'utf8')) };
    } catch {
      // Файл повреждён — начинаем заново
    }
  }

  // Ручной override из .env
  const envLevel = process.env.TRUST_LEVEL;
  if (envLevel !== undefined) {
    const level = parseInt(envLevel, 10);
    if (level >= 0 && level <= 2) {
      state.level = level;
      state.overridden = true;
    }
  }
}

function save() {
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
  writeFileSync(TRUST_PATH, JSON.stringify(state, null, 2));
}

// ── API ──

export function getTrustLevel() {
  return state.level;
}

export function getTrustName() {
  return THRESHOLDS[state.level]?.name || 'неизвестный';
}

export function getTrustState() {
  return { ...state };
}

export function recordSession() {
  state.sessions++;

  // Автоматический рост уровня (если не задан вручную)
  if (!state.overridden) {
    for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
      if (state.sessions >= THRESHOLDS[i].minSessions) {
        state.level = THRESHOLDS[i].level;
        break;
      }
    }
  }

  save();
  return state.level;
}

// Нужно ли подтверждение для операции?
// riskLevel: 'green' | 'yellow' | 'red'
export function needsConfirmation(riskLevel) {
  if (riskLevel === 'green') return false;

  if (riskLevel === 'yellow') {
    // Level 0: подтверждение на YELLOW
    // Level 1+: автоматически
    return state.level < 1;
  }

  if (riskLevel === 'red') {
    // Всегда подтверждение на RED (на всех уровнях)
    return true;
  }

  return true;
}

// ── Инициализация ──

load();

console.log(`[trust] level ${state.level} (${getTrustName()}), sessions: ${state.sessions}${state.overridden ? ' [manual]' : ''}`);
