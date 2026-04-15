#!/usr/bin/env bash
set -euo pipefail

# ─── Jarvis Bootstrap ───
# Автоматическое развёртывание AI-агента на чистом Ubuntu VPS
# Использование: curl -sL <url>/bootstrap.sh | bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1" >&2; }
ask() { echo -e "${BLUE}[?]${NC} $1"; }

JARVIS_USER="client"
JARVIS_HOME="/home/$JARVIS_USER"
DATA_DIR="$JARVIS_HOME/.jarvis"
WORKSPACE_DIR="$JARVIS_HOME/workspace"
PROJECTS_DIR="$JARVIS_HOME/projects"
REPO_URL="https://github.com/sergeigeyn/jarvis-bootstrap.git"  # ← заменить на свой

# ─── Проверки ───

if [ "$(id -u)" -ne 0 ]; then
  err "Запусти от root: sudo bash bootstrap.sh"
  exit 1
fi

if ! grep -qi 'ubuntu\|debian' /etc/os-release 2>/dev/null; then
  warn "Скрипт тестировался на Ubuntu 24.04. На другой ОС может работать криво."
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     Jarvis Bootstrap Installer       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Сбор данных ───

ask "Telegram Bot Token (от @BotFather):"
read -r BOT_TOKEN
if [ -z "$BOT_TOKEN" ]; then
  err "BOT_TOKEN обязателен"
  exit 1
fi

ask "Anthropic API Key (sk-ant-...):"
read -r ANTHROPIC_KEY
if [ -z "$ANTHROPIC_KEY" ]; then
  err "ANTHROPIC_API_KEY обязателен"
  exit 1
fi

ask "Имя агента [Джарвис]:"
read -r AGENT_NAME
AGENT_NAME="${AGENT_NAME:-Джарвис}"

ask "Твоё имя (владелец) [Сергей]:"
read -r OWNER_NAME
OWNER_NAME="${OWNER_NAME:-Сергей}"

ask "Telegram ID владельца (для ограничения доступа, можно пропустить):"
read -r ADMIN_ID

ask "Deepgram API Key (для голосовых, можно пропустить):"
read -r DEEPGRAM_KEY

echo ""
log "Начинаю установку..."

# ─── 1. Системные пакеты ───

log "Обновляю пакеты..."
apt-get update -qq
apt-get install -y -qq git curl wget build-essential

# ─── 2. Node.js 22 ───

if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  log "Устанавливаю Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
log "Node.js $(node -v)"

# ─── 3. Claude Code CLI ───

if ! command -v claude &>/dev/null; then
  log "Устанавливаю Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
fi
log "Claude Code $(claude --version 2>/dev/null || echo 'installed')"

# ─── 4. Пользователь ───

if ! id "$JARVIS_USER" &>/dev/null; then
  log "Создаю пользователя $JARVIS_USER..."
  useradd -m -s /bin/bash "$JARVIS_USER"
fi

# ─── 5. Структура папок ───

log "Создаю структуру папок..."
sudo -u "$JARVIS_USER" mkdir -p \
  "$DATA_DIR" \
  "$WORKSPACE_DIR"/{memory,knowledge,.media,.claude/skills} \
  "$PROJECTS_DIR"

# ─── 6. Клонируем репо или копируем локально ───

BOOTSTRAP_DIR="$PROJECTS_DIR/jarvis-bootstrap"
if [ -d "$BOOTSTRAP_DIR" ]; then
  log "jarvis-bootstrap уже есть, обновляю..."
  cd "$BOOTSTRAP_DIR" && sudo -u "$JARVIS_USER" git pull --ff-only 2>/dev/null || true
else
  log "Клонирую jarvis-bootstrap..."
  # Если запущено локально — копируем
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

# ─── 7. Устанавливаем зависимости ───

log "Устанавливаю зависимости бота..."
cd "$BOOTSTRAP_DIR"
sudo -u "$JARVIS_USER" npm install --production 2>/dev/null

# ─── 8. .env ───

log "Создаю .env..."
cat > "$DATA_DIR/.env" << ENVFILE
BOT_TOKEN=$BOT_TOKEN
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
AGENT_NAME=$AGENT_NAME
ADMIN_ID=$ADMIN_ID
DEEPGRAM_API_KEY=$DEEPGRAM_KEY
ENVFILE
chmod 600 "$DATA_DIR/.env"
chown "$JARVIS_USER:$JARVIS_USER" "$DATA_DIR/.env"

# ─── 9. Раскладываем шаблоны ───

log "Раскладываю конфиги..."
TEMPLATES="$BOOTSTRAP_DIR/templates"

# SOUL.md — подставляем переменные
sed "s/{{AGENT_NAME}}/$AGENT_NAME/g; s/{{OWNER_NAME}}/$OWNER_NAME/g" \
  "$TEMPLATES/workspace/SOUL.md" > "$WORKSPACE_DIR/SOUL.md"

# CLAUDE.md
cp "$TEMPLATES/workspace/CLAUDE.md" "$WORKSPACE_DIR/CLAUDE.md"

# MEMORY.md
sed "s/{{OWNER_NAME}}/$OWNER_NAME/g" \
  "$TEMPLATES/workspace/MEMORY.md" > "$WORKSPACE_DIR/MEMORY.md"

# Skills
cp -r "$TEMPLATES/skills/"* "$WORKSPACE_DIR/.claude/skills/" 2>/dev/null || true

# Фиксим владельца
chown -R "$JARVIS_USER:$JARVIS_USER" "$WORKSPACE_DIR" "$DATA_DIR" "$PROJECTS_DIR"

# ─── 10. Git для workspace ───

if [ ! -d "$WORKSPACE_DIR/.git" ]; then
  log "Инициализирую git в workspace..."
  cd "$WORKSPACE_DIR"
  sudo -u "$JARVIS_USER" git init
  sudo -u "$JARVIS_USER" git config user.name "$AGENT_NAME"
  sudo -u "$JARVIS_USER" git config user.email "agent@local"
  sudo -u "$JARVIS_USER" git add -A
  sudo -u "$JARVIS_USER" git commit -m "[bootstrap] initial setup" 2>/dev/null || true
fi

# ─── 11. Systemd сервис ───

log "Создаю systemd сервис..."
cat > /etc/systemd/system/jarvis-bot.service << SVCFILE
[Unit]
Description=Jarvis Telegram Bot
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

# Лимиты
MemoryMax=1G
CPUQuota=80%

# Логи
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jarvis-bot

[Install]
WantedBy=multi-user.target
SVCFILE

systemctl daemon-reload
systemctl enable jarvis-bot
systemctl start jarvis-bot

# ─── 12. Проверка ───

sleep 3
if systemctl is-active --quiet jarvis-bot; then
  log "Бот запущен!"
else
  err "Бот не запустился. Логи: journalctl -u jarvis-bot -n 50"
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        Установка завершена!          ║"
echo "╠══════════════════════════════════════╣"
echo "║  Бот: systemctl status jarvis-bot    ║"
echo "║  Логи: journalctl -u jarvis-bot -f   ║"
echo "║  Конфиг: $DATA_DIR/.env              ║"
echo "║  Промпты: $WORKSPACE_DIR/            ║"
echo "╚══════════════════════════════════════╝"
echo ""
log "Напиши своему боту в Telegram — он готов!"
