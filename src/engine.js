// Абстракция AI-движка: Claude Code, OpenAI Codex
import { spawn } from 'child_process';
import { config } from './config.js';
import { getOwnerName, getAgentName } from './onboarding.js';
import {
  getPermissionMode, getSessionId, setSessionId,
  detectAuthMode, recordCost, isCostPaused,
} from './state.js';

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

function parseStreamJson(raw) {
  const lines = raw.split('\n').filter(Boolean);
  let text = '';
  let totalCost = 0;
  let sessionId = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      // Текст ассистента
      if (obj.type === 'assistant' && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === 'text') text += block.text;
        }
      }

      // Результат (финальный текст)
      if (obj.type === 'result') {
        if (obj.result) text = obj.result;
        if (obj.session_id) sessionId = obj.session_id;
        if (obj.cost_usd) totalCost += obj.cost_usd;
        if (obj.total_cost_usd) totalCost = obj.total_cost_usd;
      }

      // Cost из отдельных сообщений
      if (obj.cost_usd && obj.type !== 'result') {
        totalCost += obj.cost_usd;
      }

    } catch {
      // Не JSON — пропускаем (stderr может попасть)
    }
  }

  return { text: text.trim(), cost: totalCost, sessionId };
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

  async send(prompt, { onDone, onError, onCostWarning, onCostPaused }) {
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

    const proc = spawn(this.engine.bin, args, {
      env,
      cwd: config.workspaceDir,
      timeout: 5 * 60 * 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process = proc;
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      this.busy = false;
      this.process = null;
      this.lastActivity = Date.now();

      if (code === 0 || stdout.length > 0) {
        let responseText = stdout.trim();
        let cost = 0;

        // Парсим stream-json для Claude
        if (this.engine.streaming && stdout.includes('{')) {
          const parsed = parseStreamJson(stdout);
          responseText = parsed.text || responseText;
          cost = parsed.cost;

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
