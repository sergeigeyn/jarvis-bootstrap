// Абстракция AI-движка: Claude Code, OpenAI Codex, Gemini CLI
import { spawn } from 'child_process';
import { config } from './config.js';
import { getOwnerName, getAgentName } from './onboarding.js';

// ── Конфигурации движков ──

const ENGINES = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    buildArgs: (prompt, sessionId) => {
      const args = ['--print', '--output-format', 'text'];
      if (sessionId) args.push('--session', sessionId);
      args.push(prompt);
      return args;
    },
    buildEnv: () => {
      const env = { ...process.env, HOME: config.home };
      // OAuth-токен подписки или API-ключ
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
    buildArgs: (prompt) => {
      // codex --full-auto --quiet для non-interactive режима
      return ['--full-auto', '--quiet', prompt];
    },
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
    id,
    name: e.name,
    plans: e.plans,
  }));
}

// ── Сессии ──

const sessions = new Map();

class EngineSession {
  constructor(chatId) {
    this.chatId = chatId;
    this.process = null;
    this.busy = false;
    this.lastActivity = Date.now();
    this.sessionId = null;
    this.engine = ENGINES[config.engine];
  }

  async send(prompt, { onDone, onError }) {
    if (this.busy) {
      onError?.(new Error('Сессия занята, подожди...'));
      return;
    }

    this.busy = true;
    this.lastActivity = Date.now();

    // Инъекция контекста — CLI знает кто владелец и кто он
    const owner = getOwnerName();
    const agent = getAgentName();
    const contextPrefix = `[Контекст: ты — ${agent}, владелец — ${owner}. Отвечай на русском, неформально, на ты.]\n\n`;
    const fullPrompt = contextPrefix + prompt;

    const args = this.engine.buildArgs(fullPrompt, this.sessionId);
    const env = this.engine.buildEnv();

    const proc = spawn(this.engine.bin, args, {
      env,
      cwd: config.workspaceDir,
      timeout: 5 * 60 * 1000,
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

      if (code === 0) {
        onDone?.(stdout.trim());
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
