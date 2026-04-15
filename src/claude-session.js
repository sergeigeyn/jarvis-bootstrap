// Управление сессиями Claude Code CLI
import { spawn } from 'child_process';
import { config } from './config.js';

const sessions = new Map(); // chatId -> session

class ClaudeSession {
  constructor(chatId) {
    this.chatId = chatId;
    this.process = null;
    this.busy = false;
    this.lastActivity = Date.now();
    this.sessionId = null;
  }

  async send(prompt, { onText, onDone, onError }) {
    if (this.busy) {
      onError?.(new Error('Сессия занята, подожди...'));
      return;
    }
    
    this.busy = true;
    this.lastActivity = Date.now();
    
    const args = ['--print', '--output-format', 'text'];
    
    // Если есть активная сессия — продолжаем её
    if (this.sessionId) {
      args.push('--session', this.sessionId);
    }
    
    args.push(prompt);
    
    const proc = spawn('claude', args, {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: config.anthropicKey,
        HOME: config.home,
      },
      cwd: config.workspaceDir,
      timeout: 5 * 60 * 1000, // 5 мин макс на ответ
    });
    
    this.process = proc;
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    
    proc.on('close', (code) => {
      this.busy = false;
      this.process = null;
      this.lastActivity = Date.now();
      
      if (code === 0) {
        onDone?.(stdout.trim());
      } else {
        const errMsg = stderr.trim() || `Claude exited with code ${code}`;
        console.error(`[claude] error for chat ${this.chatId}: ${errMsg}`);
        onError?.(new Error(errMsg));
      }
    });
    
    proc.on('error', (err) => {
      this.busy = false;
      this.process = null;
      console.error(`[claude] spawn error: ${err.message}`);
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
    sessions.set(chatId, new ClaudeSession(chatId));
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
