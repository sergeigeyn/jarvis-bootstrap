#!/usr/bin/env bash
set -euo pipefail

# SSH non-login shells have minimal PATH — ensure standard dirs are included
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# ─── Jarvis Bootstrap ───
# Автоматическое развёртывание AI-агента на чистом Ubuntu VPS

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1" >&2; }
ask() { echo -ne "${BLUE}[?]${NC} $1 "; }

JARVIS_USER="client"
JARVIS_HOME="/home/$JARVIS_USER"
DATA_DIR="$JARVIS_HOME/.jarvis"
WORKSPACE_DIR="$JARVIS_HOME/workspace"
PROJECTS_DIR="$JARVIS_HOME/projects"
REPO_URL="https://github.com/sergeigeyn/jarvis-bootstrap.git"

# ─── Проверки ───

if [ "$(id -u)" -ne 0 ]; then
  err "Запусти от root: sudo bash bootstrap.sh"
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     Jarvis Bootstrap Installer       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Non-interactive режим ───
# Если ENGINE и BOT_TOKEN уже заданы через env — пропускаем промпты

if [ -n "${ENGINE:-}" ] && [ -n "${BOT_TOKEN:-}" ]; then
  # Non-interactive: все данные из env vars
  case "$ENGINE" in
    gemini) ENGINE_NAME="Gemini CLI"; KEY_NAME="GEMINI_API_KEY";;
    codex)  ENGINE_NAME="OpenAI Codex"; KEY_NAME="OPENAI_API_KEY";;
    *)      ENGINE="claude"; ENGINE_NAME="Claude Code"; KEY_NAME="ANTHROPIC_API_KEY";;
  esac
  ENGINE_KEY="${ENGINE_KEY:-${!KEY_NAME:-}}"
  AGENT_NAME="${AGENT_NAME:-Джарвис}"
  OWNER_NAME="${OWNER_NAME:-Владелец}"
  ADMIN_ID="${ADMIN_ID:-}"
  DEEPGRAM_KEY="${DEEPGRAM_KEY:-}"
  log "Non-interactive: $ENGINE_NAME"
else
  # ─── 1. Выбор движка (интерактивный) ───

  echo -e "${CYAN}Выбери AI-движок:${NC}"
  echo ""
  echo "  1) 🆓 Gemini CLI   — бесплатно (Google аккаунт, 1000 req/день)"
  echo "  2) 💲 Codex CLI     — ChatGPT Plus подписка (\$20/мес)"
  echo "  3) ⭐ Claude Code   — Claude Max подписка (\$100/мес)"
  echo ""
  ask "Номер [3]:"
  read -r ENGINE_CHOICE
  case "${ENGINE_CHOICE:-3}" in
    1) ENGINE="gemini"; ENGINE_NAME="Gemini CLI"; KEY_NAME="GEMINI_API_KEY"; KEY_HINT="Gemini API Key";;
    2) ENGINE="codex"; ENGINE_NAME="OpenAI Codex"; KEY_NAME="OPENAI_API_KEY"; KEY_HINT="OpenAI API Key";;
    *) ENGINE="claude"; ENGINE_NAME="Claude Code"; KEY_NAME="ANTHROPIC_API_KEY"; KEY_HINT="Anthropic API Key (sk-ant-...)";;
  esac
  log "Движок: $ENGINE_NAME"

  # ─── 2. Сбор данных ───

  echo ""
  ask "Telegram Bot Token (от @BotFather):"
  read -r BOT_TOKEN
  [ -z "$BOT_TOKEN" ] && { err "BOT_TOKEN обязателен"; exit 1; }

  ask "$KEY_HINT:"
  read -r ENGINE_KEY
  [ -z "$ENGINE_KEY" ] && { err "$KEY_NAME обязателен"; exit 1; }

  ask "Имя агента [Джарвис]:"
  read -r AGENT_NAME
  AGENT_NAME="${AGENT_NAME:-Джарвис}"

  ask "Твоё имя [Сергей]:"
  read -r OWNER_NAME
  OWNER_NAME="${OWNER_NAME:-Сергей}"

  ask "Telegram ID владельца (можно пропустить):"
  read -r ADMIN_ID

  ask "Deepgram API Key для голосовых (можно пропустить):"
  read -r DEEPGRAM_KEY
fi

echo ""
log "Начинаю установку ($ENGINE_NAME)..."

# ─── 3. Системные пакеты ───

# Detect distro family
if command -v apt-get &>/dev/null; then
  PKG_MGR="apt"
elif command -v dnf &>/dev/null; then
  PKG_MGR="dnf"
elif command -v yum &>/dev/null; then
  PKG_MGR="yum"
elif command -v apk &>/dev/null; then
  PKG_MGR="apk"
else
  err "Неизвестный пакетный менеджер. Поддерживаются: apt, dnf, yum, apk"
  exit 1
fi
log "Пакетный менеджер: $PKG_MGR"

log "Обновляю пакеты..."
case "$PKG_MGR" in
  apt)
    apt-get update -qq
    apt-get install -y -qq git curl wget build-essential
    ;;
  dnf|yum)
    $PKG_MGR install -y git curl wget gcc gcc-c++ make
    ;;
  apk)
    apk update
    apk add git curl wget build-base bash
    ;;
esac

# ─── 4. Node.js 22 ───

if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  log "Устанавливаю Node.js 22..."
  case "$PKG_MGR" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y -qq nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      $PKG_MGR install -y nodejs
      ;;
    apk)
      apk add nodejs npm
      ;;
  esac
fi
log "Node.js $(node -v)"

# ─── 5. CLI-агент ───

install_engine() {
  case "$ENGINE" in
    claude)
      if ! command -v claude &>/dev/null; then
        log "Устанавливаю Claude Code CLI..."
        npm install -g @anthropic-ai/claude-code
      fi
      log "Claude Code $(claude --version 2>/dev/null || echo 'installed')"
      ;;
    codex)
      if ! command -v codex &>/dev/null; then
        log "Устанавливаю OpenAI Codex CLI..."
        npm install -g @openai/codex
      fi
      log "OpenAI Codex installed"
      ;;
    gemini)
      if ! command -v gemini &>/dev/null; then
        log "Устанавливаю Gemini CLI..."
        npm install -g @anthropic-ai/claude-code @google/gemini-cli
      fi
      log "Gemini CLI installed"
      ;;
  esac
}
install_engine

# ─── 6. Пользователь ───

if ! id "$JARVIS_USER" &>/dev/null; then
  log "Создаю пользователя $JARVIS_USER..."
  useradd -m -s /bin/bash "$JARVIS_USER"
fi

# ─── 7. Структура папок ───

log "Создаю структуру папок..."
sudo -u "$JARVIS_USER" mkdir -p \
  "$DATA_DIR" \
  "$WORKSPACE_DIR"/{memory,knowledge,.media,.claude/skills} \
  "$PROJECTS_DIR"

# ─── 8. Клонируем репо ───

BOOTSTRAP_DIR="$PROJECTS_DIR/jarvis-bootstrap"
if [ -d "$BOOTSTRAP_DIR" ]; then
  log "jarvis-bootstrap уже есть, обновляю..."
  cd "$BOOTSTRAP_DIR" && sudo -u "$JARVIS_USER" git pull --ff-only 2>/dev/null || true
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [ -f "$SCRIPT_DIR/src/bot.js" ]; then
    sudo -u "$JARVIS_USER" cp -r "$SCRIPT_DIR" "$BOOTSTRAP_DIR"
  else
    sudo -u "$JARVIS_USER" git clone "$REPO_URL" "$BOOTSTRAP_DIR" 2>/dev/null || {
      err "Не удалось склонировать. Скопируй репо вручную в $BOOTSTRAP_DIR"
      exit 1
    }
  fi
fi

# ─── 9. Зависимости ───

log "Устанавливаю зависимости бота..."
cd "$BOOTSTRAP_DIR"
sudo -u "$JARVIS_USER" npm install --production 2>/dev/null

# ─── 10. .env ───

log "Создаю .env..."
cat > "$DATA_DIR/.env" << ENVFILE
ENGINE=$ENGINE
BOT_TOKEN=$BOT_TOKEN
$KEY_NAME=$ENGINE_KEY
AGENT_NAME=$AGENT_NAME
ADMIN_ID=$ADMIN_ID
DEEPGRAM_API_KEY=$DEEPGRAM_KEY
ENVFILE
chmod 600 "$DATA_DIR/.env"
chown "$JARVIS_USER:$JARVIS_USER" "$DATA_DIR/.env"

# ─── 11. Шаблоны ───

log "Раскладываю конфиги..."
TEMPLATES="$BOOTSTRAP_DIR/templates"

sed "s/{{AGENT_NAME}}/$AGENT_NAME/g; s/{{OWNER_NAME}}/$OWNER_NAME/g" \
  "$TEMPLATES/workspace/SOUL.md" > "$WORKSPACE_DIR/SOUL.md"
cp "$TEMPLATES/workspace/CLAUDE.md" "$WORKSPACE_DIR/CLAUDE.md"
sed "s/{{OWNER_NAME}}/$OWNER_NAME/g" \
  "$TEMPLATES/workspace/MEMORY.md" > "$WORKSPACE_DIR/MEMORY.md"
cp -r "$TEMPLATES/skills/"* "$WORKSPACE_DIR/.claude/skills/" 2>/dev/null || true

chown -R "$JARVIS_USER:$JARVIS_USER" "$WORKSPACE_DIR" "$DATA_DIR" "$PROJECTS_DIR"

# ─── 12. Git ───

if [ ! -d "$WORKSPACE_DIR/.git" ]; then
  log "Инициализирую git..."
  cd "$WORKSPACE_DIR"
  sudo -u "$JARVIS_USER" git init
  sudo -u "$JARVIS_USER" git config user.name "$AGENT_NAME"
  sudo -u "$JARVIS_USER" git config user.email "agent@local"
  sudo -u "$JARVIS_USER" git add -A
  sudo -u "$JARVIS_USER" git commit -m "[bootstrap] initial setup" 2>/dev/null || true
fi

# ─── 13. Systemd ───

log "Создаю systemd сервис..."
cat > /etc/systemd/system/jarvis-bot.service << SVCFILE
[Unit]
Description=Jarvis AI Agent ($ENGINE_NAME)
After=network.target

[Service]
Type=simple
User=$JARVIS_USER
WorkingDirectory=$BOOTSTRAP_DIR
ExecStart=/usr/bin/node $BOOTSTRAP_DIR/src/bot.js
Restart=always
RestartSec=10
Environment=HOME=$JARVIS_HOME
EnvironmentFile=$DATA_DIR/.env

MemoryMax=1G
CPUQuota=80%
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jarvis-bot

[Install]
WantedBy=multi-user.target
SVCFILE

systemctl daemon-reload
systemctl enable jarvis-bot
systemctl start jarvis-bot

# Открываем порт 3000 для Dashboard /health endpoint
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
elif command -v ufw &>/dev/null; then
  ufw allow 3000/tcp 2>/dev/null || true
fi

# ─── 14. Проверка ───

sleep 5
if systemctl is-active --quiet jarvis-bot; then
  log "Бот запущен!"
else
  err "Бот не запустился. Диагностика:"
  echo "--- journalctl ---" >&2
  journalctl -u jarvis-bot -n 30 --no-pager 2>&1 >&2 || true
  echo "--- .env check ---" >&2
  [ -f "$DATA_DIR/.env" ] && echo ".env exists ($(wc -l < "$DATA_DIR/.env") lines)" >&2 || echo ".env MISSING" >&2
  echo "--- node check ---" >&2
  node -v 2>&1 >&2 || echo "node not found" >&2
  echo "--- service file ---" >&2
  cat /etc/systemd/system/jarvis-bot.service >&2 || true
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║          Установка завершена!            ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Движок: $(printf '%-33s' "$ENGINE_NAME")║"
echo "║  Бот: systemctl status jarvis-bot        ║"
echo "║  Логи: journalctl -u jarvis-bot -f       ║"
echo "╚══════════════════════════════════════════╝"
echo ""
log "Напиши своему боту в Telegram — он готов!"
