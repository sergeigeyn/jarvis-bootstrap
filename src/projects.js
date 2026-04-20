// Проекты — inline-меню со списком, переключение, пагинация
import { InlineKeyboard } from 'grammy';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { setSessionId } from './state.js';

const PROJECTS_PER_PAGE = 9;

// ── Текущий проект ──

let currentProject = null;

function loadCurrentProject() {
  const statePath = join(config.dataDir, 'project.json');
  if (existsSync(statePath)) {
    try {
      const data = JSON.parse(readFileSync(statePath, 'utf8'));
      currentProject = data.current || null;
    } catch { /* ignore */ }
  }
}

function saveCurrentProject() {
  const statePath = join(config.dataDir, 'project.json');
  try {
    if (!existsSync(config.dataDir)) {
      mkdirSync(config.dataDir, { recursive: true });
    }
    writeFileSync(statePath, JSON.stringify({ current: currentProject }, null, 2));
  } catch { /* ignore */ }
}

loadCurrentProject();

export function getCurrentProject() {
  return currentProject;
}

export function switchProject(name) {
  currentProject = name;
  saveCurrentProject();
}

// Резолвим имя проекта → абсолютный путь для CWD движка
export function resolveProjectDir() {
  if (!currentProject) return config.workspaceDir;

  // ~/workspace или ~/workspace/subfolder
  if (currentProject.startsWith('~/workspace')) {
    const rel = currentProject.replace('~/workspace', '');
    if (rel) {
      const resolved = join(config.workspaceDir, rel.slice(1));
      // Защита от path traversal (../../)
      if (!resolved.startsWith(config.workspaceDir)) return config.workspaceDir;
      return resolved;
    }
    return config.workspaceDir;
  }

  // Имя проекта из ~/projects/ — защита от ../
  const safeName = currentProject.replace(/\.\./g, '').replace(/[\/\\]/g, '');
  const projectPath = join(config.projectsDir, safeName);
  if (!projectPath.startsWith(config.projectsDir)) return config.workspaceDir;
  if (existsSync(projectPath)) return projectPath;

  // fallback
  return config.workspaceDir;
}

// ── Список проектов ──

// Служебные папки workspace — НЕ проекты
const WORKSPACE_SKIP = new Set([
  'memory', 'knowledge', '.claude', '.git', 'node_modules',
]);

// Системные проекты — НЕ показываем (агент может повредить свой же код)
const SYSTEM_PROJECTS = new Set([
  'jarvis-bootstrap', 'jarvis-installer', 'helper-aishnik',
]);

function getProjectsList() {
  const projects = [];

  if (existsSync(config.workspaceDir)) {
    projects.push('~/workspace');

    // Подпапки workspace = проекты (кроме служебных)
    const wsDirs = readdirSync(config.workspaceDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !WORKSPACE_SKIP.has(d.name))
      .map(d => `~/workspace/${d.name}`)
      .sort();
    projects.push(...wsDirs);
  }

  if (existsSync(config.projectsDir)) {
    const dirs = readdirSync(config.projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !SYSTEM_PROJECTS.has(d.name))
      .map(d => d.name)
      .sort();
    projects.push(...dirs);
  }

  return projects;
}

// ── Текст ──

export function getProjectsText(page = 0) {
  const projects = getProjectsList();
  const total = projects.length;

  let text = `📁 <b>Проекты</b> (${total}):\n\n`;

  for (const p of projects) {
    const isCurrent = (currentProject === p) || (!currentProject && p === '~/workspace');
    const marker = isCurrent ? '▸ ' : '  ';
    text += `${marker}${p}\n`;
  }

  text += `\nПереключить: <code>/project название</code>`;
  return text;
}

// ── Клавиатура с пагинацией ──

export function buildProjectsKeyboard(page = 0) {
  const projects = getProjectsList();
  const totalPages = Math.ceil(projects.length / PROJECTS_PER_PAGE);
  const start = page * PROJECTS_PER_PAGE;
  const pageProjects = projects.slice(start, start + PROJECTS_PER_PAGE);

  const kb = new InlineKeyboard();

  // ~/workspace на всю ширину (только на первой странице)
  if (page === 0) {
    const wsIdx = projects.indexOf('~/workspace');
    kb.text('🏠 Workspace', `projects:s:${wsIdx}`).row();
  }

  // Проекты по 2 в ряд (больше места для имён)
  const items = page === 0
    ? pageProjects.filter(p => p !== '~/workspace')
    : pageProjects;

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const idx = projects.indexOf(p);
    const isCurrent = currentProject === p;
    const name = displayName(p);
    const label = isCurrent ? `✓ ${truncate(name, 18)}` : truncate(name, 20);
    kb.text(label, `projects:s:${idx}`);
    if ((i + 1) % 2 === 0) kb.row();
  }

  // Завершаем ряд если не кратно 2
  if (items.length % 2 !== 0) kb.row();

  // Пагинация
  if (totalPages > 1) {
    if (page > 0) kb.text('◀', `projects:page:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'projects:noop');
    if (page < totalPages - 1) kb.text('▶', `projects:page:${page + 1}`);
    kb.row();
  }

  kb.text('➕ Новый проект', 'projects:new').row();
  kb.text('« Назад', 'menu:back');

  return kb;
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

// Короткое имя для кнопки (без ~/workspace/ префикса)
function displayName(projectPath) {
  if (projectPath === '~/workspace') return '🏠 Workspace';
  if (projectPath.startsWith('~/workspace/')) return projectPath.replace('~/workspace/', '');
  return projectPath;
}

// ── Callback обработчик ──

export async function handleProjectsCallback(ctx, handleMessage) {
  const data = ctx.callbackQuery.data;

  if (data === 'projects:noop') {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith('projects:page:')) {
    const page = parseInt(data.split(':')[2], 10);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(getProjectsText(page), {
      parse_mode: 'HTML',
      reply_markup: buildProjectsKeyboard(page),
    });
    return;
  }

  if (data.startsWith('projects:s:') || data.startsWith('projects:switch:')) {
    let projectName;

    if (data.startsWith('projects:s:')) {
      // Новый формат: индекс
      const idx = parseInt(data.replace('projects:s:', ''), 10);
      const projects = getProjectsList();
      projectName = projects[idx];
      if (!projectName) {
        await ctx.answerCallbackQuery({ text: 'Проект не найден. Обнови список.' });
        return;
      }
    } else {
      // Старый формат: полное имя (обратная совместимость с кешированными кнопками)
      projectName = data.replace('projects:switch:', '');
    }

    // Блокируем системные проекты (на случай кеша старой клавиатуры)
    if (SYSTEM_PROJECTS.has(projectName)) {
      await ctx.answerCallbackQuery({ text: '⛔ Системный проект — доступ закрыт' });
      return;
    }

    switchProject(projectName);
    setSessionId(null);
    await ctx.answerCallbackQuery();
    // Обновляем список проектов (галочка переместится)
    try {
      await ctx.editMessageText(getProjectsText(), {
        parse_mode: 'HTML',
        reply_markup: buildProjectsKeyboard(),
      });
    } catch { /* message not modified — ok */ }
    // Явное подтверждение — как /project команда
    const displayProjectName = projectName.replace('~/workspace/', '').replace('~/workspace', 'Workspace');
    await ctx.reply(`📍 Переключился на проект <b>${displayProjectName}</b>`, { parse_mode: 'HTML' });
    return;
  }

  if (data === 'projects:new') {
    await ctx.answerCallbackQuery();
    await handleMessage(ctx, 'Создай новый проект в ~/projects/<название>/. Спроси у меня название и описание. Инициализируй git.');
    return;
  }

  await ctx.answerCallbackQuery();
}
