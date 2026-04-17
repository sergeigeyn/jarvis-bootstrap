// Онбординг — первое знакомство с владельцем
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

const PROFILE_PATH = join(config.dataDir, 'profile.json');

// ── Профиль ──

const defaultProfile = {
  ownerName: null,
  agentName: config.agentName || 'Джарвис',
  onboarded: false,
  createdAt: null,
};

let profile = { ...defaultProfile };

function load() {
  if (existsSync(PROFILE_PATH)) {
    try {
      profile = { ...defaultProfile, ...JSON.parse(readFileSync(PROFILE_PATH, 'utf8')) };
    } catch {
      // повреждён — начинаем заново
    }
  }
}

function save() {
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
}

load();

// ── Геттеры ──

export function getProfile() {
  return { ...profile };
}

export function isOnboarded() {
  return profile.onboarded && profile.ownerName;
}

export function getOwnerName() {
  return profile.ownerName || 'друг';
}

export function getAgentName() {
  return profile.agentName || config.agentName || 'Джарвис';
}

// ── Сеттеры ──

export function setOwnerName(name) {
  profile.ownerName = name;
  save();
  updateTemplates();
}

export function setAgentName(name) {
  profile.agentName = name;
  config.agentName = name;
  save();
  updateTemplates();
}

export function completeOnboarding() {
  profile.onboarded = true;
  profile.createdAt = new Date().toISOString();
  save();
  updateTemplates();
}

export function resetOnboarding() {
  profile.ownerName = null;
  profile.onboarded = false;
  save();
}

// ── Обновление SOUL.md и MEMORY.md ──

function updateTemplates() {
  const owner = profile.ownerName || 'Владелец';
  const agent = profile.agentName || 'Джарвис';

  // SOUL.md
  const soulPath = join(config.workspaceDir, 'SOUL.md');
  if (existsSync(soulPath)) {
    let soul = readFileSync(soulPath, 'utf8');
    // Заменяем имя агента
    soul = soul.replace(/^Имя: .+$/m, `Имя: ${agent}`);
    // Заменяем имя владельца (строка с производными имени)
    soul = soul.replace(/^- .+ — любые производные имени ок$/m, `- ${owner} — любые производные имени ок`);
    writeFileSync(soulPath, soul);
  }

  // MEMORY.md
  const memPath = join(config.workspaceDir, 'MEMORY.md');
  if (existsSync(memPath)) {
    let mem = readFileSync(memPath, 'utf8');
    mem = mem.replace(/^- Имя: .+$/m, `- Имя: ${owner}`);
    writeFileSync(memPath, mem);
  }
}

// ── Состояния онбординга ──

const onboardingState = new Map(); // chatId → state

export function getOnboardingState(chatId) {
  return onboardingState.get(chatId) || null;
}

export function setOnboardingState(chatId, state) {
  onboardingState.set(chatId, state);
}

export function clearOnboardingState(chatId) {
  onboardingState.delete(chatId);
}

// ── Сообщения онбординга ──

export function getWelcomeMessage() {
  const agent = getAgentName();
  return (
    `Привет! Я <b>${agent}</b> — твой AI-ассистент.\n\n` +
    `Я умею работать с кодом, файлами, искать в интернете, ` +
    `обрабатывать голосовые и фото.\n\n` +
    `Для начала — <b>как тебя зовут?</b>`
  );
}

export function getGreetingAfterName(ownerName) {
  const agent = getAgentName();
  return (
    `Приятно познакомиться, <b>${ownerName}</b>! :)\n\n` +
    `Я — <b>${agent}</b>. Буду твоим напарником: помогу с кодом, ` +
    `задачами, автоматизацией — чем скажешь.\n\n` +
    `Общаюсь неформально, на ты. Если идея плохая — скажу прямо. ` +
    `Если могу сделать сам — сделаю, не буду спрашивать.\n\n` +
    `Настройки: /settings\n` +
    `Сброс сессии: /reset\n\n` +
    `Чем займёмся?`
  );
}

export function getReturningMessage() {
  const owner = getOwnerName();
  const agent = getAgentName();
  return (
    `С возвращением, <b>${owner}</b>! ` +
    `${agent} на связи. Чем займёмся?`
  );
}

console.log(`[onboarding] profile loaded, onboarded: ${profile.onboarded}, owner: ${profile.ownerName || '(not set)'}`);
