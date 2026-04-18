// Абстракция AI-движка: Claude Code, OpenAI Codex
import { spawn } from 'child_process';
import { config } from './config.js';
import { getOwnerName, getAgentName } from './onboarding.js';
import {
  getPermissionMode, getSessionId, setSessionId,
  detectAuthMode, recordCost, isCostPaused,
} from './state.js';
import { resolveProjectDir } from './projects.js';

// ── Disallowed tools (блокировка опасных паттернов на уровне CLI) ──

const DISALLOWED_TOOLS = [
  'Bash(rm -rf *)', 'Bash(rm -r *)', 'Bash(sudo *)',
  'Bash(kill *)', 'Bash(pkill *)', 'Bash(shutdown *)',
  'Bash(reboot *)', 'Bash(mkfs *)', 'Bash(dd if=*)',
];

const BASE_ALLOWED_TOOLS = 'Bash,WebSearch,WebFetch';

// ── Конфигурации движков ──

const ENGINES = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    streaming: true,
    buildArgs: (prompt, sessionId, permMode) => {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
        '--max-turns', '25',
        '--permission-mode', permMode === 'auto' ? 'acceptEdits' : 'bypassPermissions',
        '--allowedTools', BASE_ALLOWED_TOOLS,
        '--disallowedTools', DISALLOWED_TOOLS.join(','),
      ];
      if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
      if (sessionId) args.push('--resume', sessionId);
      return args;
    },
    buildEnv: () => {
      const env = { ...process.env, HOME: config.home };
      if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
        env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      }
      if (process.env.ANTHROPIC_API_KEY) {
        env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      }
      return env;
    },
    install: 'npm install -g @anthropic-ai/claude-code',
    authEnv: 'ANTHROPIC_API_KEY',
    plans: 'Claude Max ($100/мес) или API credits',
  },

  codex: {
    name: 'OpenAI Codex',
    bin: 'codex',
    streaming: false,
    buildArgs: (prompt) => ['--full-auto', '--quiet', prompt],
    buildEnv: () => ({
      ...process.env,
      OPENAI_API_KEY: config.engineKey,
      HOME: config.home,
    }),
    install: 'npm install -g @openai/codex',
    authEnv: 'OPENAI_API_KEY',
    plans: 'ChatGPT Plus ($20/мес) или API key',
  },
};

export function getEngineInfo(engineId) {
  return ENGINES[engineId] || ENGINES.claude;
}

export function listEngines() {
  return Object.entries(ENGINES).map(([id, e]) => ({
    id, name: e.name, plans: e.plans,
  }));
}

// ── Парсинг stream-json ──

// Маппинг tool name → человекочитаемый статус
const TOOL_LABELS = {
  Read: 'Читаю файл',
  Edit: 'Редактирую',
  Write: 'Пишу файл',
  Bash: 'Выполняю команду',
  Glob: 'Ищу файлы',
  Grep: 'Ищу в коде',
  WebSearch: 'Ищу в интернете',
  WebFetch: 'Загружаю страницу',
  Agent: 'Запускаю агента',
  TodoWrite: 'Обновляю задачи',
};

function parseStreamLine(line) {
  try {
    const obj = JSON.parse(line);

    // Thinking
    if (obj.type === 'assistant' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'thinking') return { event: 'thinking' };
        if (block.type === 'tool_use') {
          const label = TOOL_LABELS[block.name] || block.name;
          return { event: 'tool_use', tool: block.name, label };
        }
        if (block.type === 'text') return { event: 'text', text: block.text };
      }
    }

    // Result
    if (obj.type === 'result') {
      return {
        event: 'result',
        text: obj.result || '',
        isError: obj.is_error || false,
        errors: obj.errors || [],
        sessionId: obj.session_id || null,
        cost: obj.total_cost_usd || obj.cost_usd || 0,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseStreamJson(raw) {
  const lines = raw.split('\n').filter(Boolean);
  let text = '';
  let totalCost = 0;
  let sessionId = null;
  let isError = false;
  let errors = [];

  for (const line of lines) {
    const parsed = parseStreamLine(line);
    if (!parsed) continue;

    if (parsed.event === 'text') text += parsed.text;
    if (parsed.event === 'result') {
      if (parsed.text) text = parsed.text;
      if (parsed.sessionId) sessionId = parsed.sessionId;
      if (parsed.cost) totalCost = parsed.cost;
      if (parsed.isError) { isError = true; errors = parsed.errors; }
    }
  }

  return { text: text.trim(), cost: totalCost, sessionId, isError, errors };
}

// ── Сессии ──

const sessions = new Map();

class EngineSession {
  constructor(chatId) {
    this.chatId = chatId;
    this.process = null;
    this.busy = false;
    this.lastActivity = Date.now();
    this.engine = ENGINES[config.engine];
  }

  async send(prompt, { onDone, onError, onProgress, onCostWarning, onCostPaused, _retried } = {}) {
    if (this.busy) {
      onError?.(new Error('Сессия занята, подожди...'));
      return;
    }

    // Проверяем паузу по расходам
    if (isCostPaused()) {
      onError?.(new Error('⏸ Достигнут дневной лимит расходов. Снять паузу: /settings → Лимит расходов'));
      return;
    }

    this.busy = true;
    this.lastActivity = Date.now();
    this.startedAt = Date.now();

    // Автодетект auth mode при первом запросе
    detectAuthMode();

    // Инъекция контекста
    const owner = getOwnerName();
    const agent = getAgentName();
    const contextPrefix = `[Контекст: ты — ${agent}, владелец — ${owner}. Отвечай на русском, неформально, на ты.]\n\n`;
    const fullPrompt = contextPrefix + prompt;

    // Получаем persistентный sessionId
    const sessionId = getSessionId();
    const permMode = getPermissionMode();
    const args = this.engine.buildArgs(fullPrompt, sessionId, permMode);
    const env = this.engine.buildEnv();

    const cwd = resolveProjectDir();
    const proc = spawn(this.engine.bin, args, {
      env,
      cwd,
      timeout: 5 * 60 * 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process = proc;
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    proc.stdout.on('data', (chunk) => {
      const data = chunk.toString();
      stdout += data;

      // Построчный парсинг для прогресс-статусов
      if (this.engine.streaming && onProgress) {
        lineBuffer += data;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // неполная строка — оставляем

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseStreamLine(line);
          if (parsed && (parsed.event === 'thinking' || parsed.event === 'tool_use')) {
            const elapsed = Math.round((Date.now() - this.startedAt) / 1000);
            onProgress({ ...parsed, elapsed });
          }
        }
      }
    });

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      this.busy = false;
      this.process = null;
      this.lastActivity = Date.now();

      if (code === 0 || stdout.length > 0) {
        let responseText = '';
        let cost = 0;

        // Парсим stream-json для Claude
        if (this.engine.streaming && stdout.includes('{')) {
          const parsed = parseStreamJson(stdout);
          responseText = parsed.text;
          cost = parsed.cost;

          // Ошибка от CLI — не показываем raw JSON
          if (parsed.isError) {
            const errMsg = parsed.errors.join('; ') || 'Ошибка движка';
            console.error(`[engine:${config.engine}] CLI error: ${errMsg}`);

            // Сессия протухла — сбрасываем и ретраим один раз
            if (errMsg.includes('No conversation found') && !_retried) {
              setSessionId(null);
              console.log(`[engine] stale session, retrying without --resume`);
              this.send(prompt, { onDone, onError, onProgress, onCostWarning, onCostPaused, _retried: true });
              return;
            }

            setSessionId(null);
            onError?.(new Error(errMsg));
            return;
          }

          // Сохраняем sessionId
          if (parsed.sessionId) {
            setSessionId(parsed.sessionId);
          }

          // Записываем расход
          if (cost > 0) {
            const { paused, warning } = recordCost(cost);
            if (paused) onCostPaused?.();
            else if (warning) onCostWarning?.(cost);
          }
        } else {
          // Не stream-json (Codex) — используем stdout как есть
          responseText = stdout.trim();
        }

        onDone?.(responseText);
      } else {
        const errMsg = stderr.trim() || `${this.engine.name} exited with code ${code}`;
        console.error(`[engine:${config.engine}] error for chat ${this.chatId}: ${errMsg}`);
        onError?.(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      this.busy = false;
      this.process = null;
      console.error(`[engine:${config.engine}] spawn error: ${err.message}`);
      onError?.(err);
    });
  }

  kill() {
    if (this.process) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process) this.process.kill('SIGKILL');
      }, 5000);
    }
  }
}

export function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, new EngineSession(chatId));
  }
  return sessions.get(chatId);
}

export function killSession(chatId) {
  const session = sessions.get(chatId);
  if (session) {
    session.kill();
    sessions.delete(chatId);
  }
}

// Очистка неактивных сессий
setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if (now - session.lastActivity > config.sessionTimeoutMs && !session.busy) {
      console.log(`[sessions] cleaning up idle session for chat ${chatId}`);
      session.kill();
      sessions.delete(chatId);
    }
  }
}, 60_000);
