// Проекты — inline-меню со списком, переключение, пагинация
import { InlineKeyboard } from 'grammy';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

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

// ── Список проектов ──

// Служебные папки workspace — НЕ проекты
const WORKSPACE_SKIP = new Set([
  'memory', 'knowledge', '.claude', '.git', 'node_modules',
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
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
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
    kb.text('📁 ~/workspace', 'projects:switch:~/workspace').row();
  }

  // Проекты по 3 в ряд
  const items = page === 0
    ? pageProjects.filter(p => p !== '~/workspace')
    : pageProjects;

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const isCurrent = currentProject === p;
    const label = isCurrent ? `✓ ${truncate(p, 12)}` : truncate(p, 14);
    kb.text(label, `projects:switch:${p}`);
    if ((i + 1) % 3 === 0) kb.row();
  }

  // Завершаем ряд если не кратно 3
  if (items.length % 3 !== 0) kb.row();

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

  if (data.startsWith('projects:switch:')) {
    const projectName = data.replace('projects:switch:', '');
    currentProject = projectName;
    saveCurrentProject();
    await ctx.answerCallbackQuery({ text: `Проект: ${projectName}` });
    await ctx.editMessageText(getProjectsText(), {
      parse_mode: 'HTML',
      reply_markup: buildProjectsKeyboard(),
    });
    return;
  }

  if (data === 'projects:new') {
    await ctx.answerCallbackQuery();
    await handleMessage(ctx, 'Создай новый проект в ~/projects/<название>/. Спроси у меня название и описание. Инициализируй git.');
    return;
  }

  await ctx.answerCallbackQuery();
}
