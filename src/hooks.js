// Код-гейты безопасности — детерминистический слой
// Модель не участвует в решении. Код всегда исполняется.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

// ── Встроенные правила блокировки команд ──

const BUILTIN_BLOCK = [
  { pattern: /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r|--force|--recursive)\b/i, reason: 'Деструктивное удаление файлов' },
  { pattern: /\bsudo\s+rm\b/i, reason: 'Удаление с правами root' },
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i, reason: 'Удаление структуры БД' },
  { pattern: /\bTRUNCATE\s/i, reason: 'Очистка таблицы' },
  { pattern: /\bDELETE\s+FROM\b.*(?:WHERE\s+1|WHERE\s+true|;)\s*$/im, reason: 'Массовое удаление записей' },
  { pattern: /\bgit\s+push\s+.*--force\b/i, reason: 'Принудительный push' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'Сброс с потерей изменений' },
  { pattern: /\bgit\s+branch\s+-D\b/i, reason: 'Принудительное удаление ветки' },
  { pattern: /\bgit\s+clean\s+-f\b/i, reason: 'Удаление untracked файлов' },
  { pattern: /\bkill\s+-9\b/i, reason: 'Принудительное завершение процесса' },
  { pattern: /\bpkill\s/i, reason: 'Массовое завершение процессов' },
  { pattern: /\bshutdown\b/i, reason: 'Выключение сервера' },
  { pattern: /\breboot\b/i, reason: 'Перезагрузка сервера' },
  { pattern: /\bmkfs\b/i, reason: 'Форматирование диска' },
  { pattern: /\bdd\s+if=/i, reason: 'Прямая запись на диск' },
];

// ── Встроенные паттерны секретов ──

const BUILTIN_SECRETS = [
  { pattern: /sk-ant-api[a-zA-Z0-9_-]{20,}/g, replace: 'sk-ant-***' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replace: 'sk-***' },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/g, replace: 'ghp_***' },
  { pattern: /gho_[a-zA-Z0-9]{36,}/g, replace: 'gho_***' },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, replace: 'github_pat_***' },
  { pattern: /xoxb-[a-zA-Z0-9-]+/g, replace: 'xoxb-***' },
  { pattern: /xoxp-[a-zA-Z0-9-]+/g, replace: 'xoxp-***' },
  { pattern: /Bearer\s+eyJ[a-zA-Z0-9_-]{20,}/g, replace: 'Bearer ***' },
  { pattern: /AKIA[A-Z0-9]{16}/g, replace: 'AKIA***' },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/g, replace: '[PRIVATE KEY MASKED]' },
  { pattern: /[a-zA-Z0-9_-]*(?:api[_-]?key|secret|token|password|passwd|credentials)[a-zA-Z0-9_-]*\s*[=:]\s*['"]?[a-zA-Z0-9_\-/.+]{16,}['"]?/gi, replace: (m) => m.split(/[=:]/)[0] + '=***' },
];

// ── Загрузка пользовательских хуков ──

let userHooks = { block: [], mask: [] };

function loadUserHooks() {
  const hookPath = join(config.dataDir, 'hooks.json');
  if (existsSync(hookPath)) {
    try {
      const data = JSON.parse(readFileSync(hookPath, 'utf8'));
      userHooks = {
        block: (data.block || []).map(h => ({
          pattern: new RegExp(h.pattern, 'i'),
          reason: h.reason || 'Заблокировано пользовательским хуком',
        })),
        mask: (data.mask || []).map(h => ({
          pattern: new RegExp(h.pattern, 'g'),
          replace: h.replace || '***',
        })),
      };
      console.log(`[hooks] loaded ${userHooks.block.length} block + ${userHooks.mask.length} mask rules`);
    } catch (err) {
      console.error(`[hooks] failed to load hooks.json: ${err.message}`);
    }
  }
}

loadUserHooks();

// ── Pre-command: проверка промпта перед отправкой в CLI ──

export function checkCommand(text) {
  const allRules = [...BUILTIN_BLOCK, ...userHooks.block];
  for (const rule of allRules) {
    if (rule.pattern.test(text)) {
      return { blocked: true, reason: rule.reason };
    }
  }
  return { blocked: false };
}

// ── Post-response: маскировка секретов в ответе ──

export function maskSecrets(text) {
  let result = text;
  let masked = false;
  const allMasks = [...BUILTIN_SECRETS, ...userHooks.mask];

  for (const rule of allMasks) {
    // Сбрасываем lastIndex для regex с флагом g
    if (rule.pattern.lastIndex) rule.pattern.lastIndex = 0;
    if (rule.pattern.test(result)) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, typeof rule.replace === 'function' ? rule.replace : rule.replace);
      masked = true;
    }
  }

  if (masked) {
    console.log('[hooks] secrets masked in response');
  }

  return result;
}

// ── Детект секретов во входящих сообщениях ──

const SENSITIVE_PATTERNS = [
  { pattern: /sk-ant-oat[a-zA-Z0-9_-]{20,}/, type: 'engine_key', engine: 'claude', name: 'Claude OAuth токен' },
  { pattern: /sk-ant-api[a-zA-Z0-9_-]{20,}/, type: 'engine_key', engine: 'claude', name: 'Anthropic API ключ' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/, type: 'engine_key', engine: 'codex', name: 'OpenAI API ключ' },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/, type: 'secret', name: 'GitHub Personal Access Token' },
  { pattern: /gho_[a-zA-Z0-9]{36,}/, type: 'secret', name: 'GitHub OAuth Token' },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/, type: 'secret', name: 'GitHub Fine-grained Token' },
  { pattern: /xoxb-[a-zA-Z0-9-]{20,}/, type: 'secret', name: 'Slack Bot Token' },
  { pattern: /xoxp-[a-zA-Z0-9-]{20,}/, type: 'secret', name: 'Slack User Token' },
  { pattern: /AKIA[A-Z0-9]{16}/, type: 'secret', name: 'AWS Access Key' },
  { pattern: /eyJ[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]{50,}/, type: 'secret', name: 'JWT токен' },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, type: 'secret', name: 'Приватный ключ' },
];

export function detectSensitiveInput(text) {
  const clean = text.trim().replace(/^[`§'"]+|[`§'"]+$/g, '');
  for (const rule of SENSITIVE_PATTERNS) {
    const match = clean.match(rule.pattern);
    if (match) {
      return { type: rule.type, engine: rule.engine || null, name: rule.name, value: match[0] };
    }
  }
  return null;
}

// ── Markdown → HTML для Telegram ──

function escapeHtmlEntities(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(text) {
  // 1. Извлекаем code-блоки и inline-code ДО конвертации markdown
  //    Содержимое code-блоков тоже эскейпим (< > & внутри <pre> ломают Telegram)
  const codeBlocks = [];
  let result = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre>${escapeHtmlEntities(code)}</pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });
  result = result.replace(/`([^`\n]+)`/g, (_, code) => {
    codeBlocks.push(`<code>${escapeHtmlEntities(code)}</code>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // 2. Эскейпим HTML-сущности в обычном тексте, но сохраняем валидные Telegram HTML-теги
  const TELEGRAM_TAGS = 'b|i|u|s|code|pre|a|blockquote|tg-spoiler|tg-emoji';
  const tagRe = new RegExp(`<(/?(${TELEGRAM_TAGS})(?:\\s[^>]*)?)>`, 'gi');
  const savedTags = [];
  result = result.replace(tagRe, (m) => {
    savedTags.push(m);
    return `\x00TG${savedTags.length - 1}\x00`;
  });
  result = escapeHtmlEntities(result);
  result = result.replace(/\x00TG(\d+)\x00/g, (_, i) => savedTags[i]);

  // 3. Конвертируем markdown → HTML-теги
  // **bold** → <b>bold</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // *italic* → <i>italic</i> (но не внутри уже конвертированных тегов)
  result = result.replace(/(?<![<\w])(\*)(?!\*)(.+?)\1(?![>*])/g, '<i>$2</i>');
  // ### heading → <b>heading</b>
  result = result.replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>');
  // - list → • list
  result = result.replace(/^[\s]*[-*]\s+/gm, '• ');

  // 4. Возвращаем code-блоки на место
  result = result.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[i]);
  return result;
}

// ── Полная проверка ответа ──

export function processResponse(text) {
  let result = maskSecrets(text);
  result = mdToHtml(result);
  return result;
}
