// Онбординг — первое знакомство с владельцем + управление шаблонами
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates', 'workspace');

// Версия шаблонов — увеличивай при обновлении SOUL.md / CLAUDE.md / SERVICES.md в templates/
const TEMPLATE_VERSION = 2;

const PROFILE_PATH = join(config.dataDir, 'profile.json');

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Профиль ──

const defaultProfile = {
  ownerName: null,
  agentName: config.agentName || 'Джарвис',
  onboarded: false,
  createdAt: null,
  templateVersion: 0,
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
  applyTemplates();
}

export function setAgentName(name) {
  profile.agentName = name;
  config.agentName = name;
  save();
  applyTemplates();
}

export function completeOnboarding() {
  profile.onboarded = true;
  profile.createdAt = new Date().toISOString();
  save();
  applyTemplates();
}

export function resetOnboarding() {
  profile.ownerName = null;
  profile.onboarded = false;
  save();
}

// ── Применение шаблонов (SOUL.md, CLAUDE.md) с подстановкой имён ──

function applyTemplates() {
  const owner = profile.ownerName || 'Владелец';
  const agent = profile.agentName || 'Джарвис';

  // Ensure workspace exists
  if (!existsSync(config.workspaceDir)) {
    mkdirSync(config.workspaceDir, { recursive: true });
  }

  // Применяем шаблоны SOUL.md, CLAUDE.md, SERVICES.md из templates/workspace/
  for (const file of ['SOUL.md', 'CLAUDE.md', 'SERVICES.md']) {
    const templatePath = join(TEMPLATES_DIR, file);
    if (!existsSync(templatePath)) continue;

    let content = readFileSync(templatePath, 'utf8');
    content = content.replace(/\{\{AGENT_NAME\}\}/g, agent);
    content = content.replace(/\{\{OWNER_NAME\}\}/g, owner);

    writeFileSync(join(config.workspaceDir, file), content);
  }

  // MEMORY.md — только при первом создании, никогда не перезаписываем
  const memPath = join(config.workspaceDir, 'MEMORY.md');
  if (!existsSync(memPath)) {
    const memTemplate = join(TEMPLATES_DIR, 'MEMORY.md');
    if (existsSync(memTemplate)) {
      let mem = readFileSync(memTemplate, 'utf8');
      mem = mem.replace(/\{\{OWNER_NAME\}\}/g, owner);
      writeFileSync(memPath, mem);
    }
  }

  profile.templateVersion = TEMPLATE_VERSION;
  save();
}

// ── Проверка обновления шаблонов (вызывается при старте бота) ──

export function checkTemplateUpgrade() {
  if (!profile.onboarded) return false;
  if ((profile.templateVersion || 0) >= TEMPLATE_VERSION) return false;

  console.log(`[onboarding] upgrading templates: v${profile.templateVersion || 0} → v${TEMPLATE_VERSION}`);
  applyTemplates();
  return true;
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
    `Приятно познакомиться, <b>${escapeHtml(ownerName)}</b>! :)\n\n` +
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
    `С возвращением, <b>${escapeHtml(owner)}</b>! ` +
    `${agent} на связи. Чем займёмся?`
  );
}

console.log(`[onboarding] profile loaded, onboarded: ${profile.onboarded}, owner: ${profile.ownerName || '(not set)'}`);
