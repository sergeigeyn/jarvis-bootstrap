// Конфигурация из переменных окружения
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const HOME = process.env.HOME || '/home/client';
const DATA_DIR = join(HOME, '.jarvis');

// Загрузка .env файла если есть
const envPath = join(DATA_DIR, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

export const config = {
  // Обязательные
  botToken: process.env.BOT_TOKEN,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  
  // Опциональные
  adminId: process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null,
  agentName: process.env.AGENT_NAME || 'Джарвис',
  deepgramKey: process.env.DEEPGRAM_API_KEY,
  
  // Пути
  home: HOME,
  dataDir: DATA_DIR,
  workspaceDir: join(HOME, 'workspace'),
  projectsDir: join(HOME, 'projects'),
  schedulesPath: join(DATA_DIR, 'schedules.json'),
  
  // Лимиты
  messageMaxLen: 4000,
  sessionTimeoutMs: 10 * 60 * 1000, // 10 мин без активности — убить сессию
  maxConcurrentSessions: 3,
};

// Валидация
if (!config.botToken) throw new Error('BOT_TOKEN is required. Set it in ~/.jarvis/.env');
if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY is required. Set it in ~/.jarvis/.env');
