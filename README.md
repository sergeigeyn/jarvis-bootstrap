# Jarvis Bootstrap

Самодеплоящийся AI-агент: Telegram-бот на базе Claude Code CLI.

## Что это

Telegram-бот, который:
- Принимает текст, голосовые, фото, документы
- Обрабатывает через Claude Code CLI (полный доступ к файлам, shell, git, интернету)
- Отправляет ответ с медиа обратно в Telegram
- Имеет настраиваемую личность (SOUL.md), правила (CLAUDE.md), навыки (skills)
- Поддерживает таймеры/расписания

## Быстрый старт

### Вариант 1: Автоустановка на VPS

```bash
# На чистом Ubuntu 24.04 VPS (от root):
git clone https://github.com/OWNER/jarvis-bootstrap.git /tmp/jb
sudo bash /tmp/jb/scripts/bootstrap.sh
```

Скрипт спросит:
1. **Telegram Bot Token** — создай бота через [@BotFather](https://t.me/BotFather)
2. **Anthropic API Key** — получи на [console.anthropic.com](https://console.anthropic.com)
3. **Имя агента** — как к нему обращаться (по умолчанию "Джарвис")
4. **Твоё имя** — как агент будет обращаться к тебе
5. **Telegram ID** (опционально) — ограничить доступ только тебе
6. **Deepgram Key** (опционально) — для распознавания голосовых

### Вариант 2: Ручная установка

```bash
# Зависимости
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
npm install -g @anthropic-ai/claude-code

# Бот
git clone https://github.com/OWNER/jarvis-bootstrap.git
cd jarvis-bootstrap && npm install

# Конфиг
mkdir -p ~/.jarvis
cat > ~/.jarvis/.env << EOF
BOT_TOKEN=твой_токен
ANTHROPIC_API_KEY=sk-ant-...
AGENT_NAME=Джарвис
ADMIN_ID=твой_telegram_id
EOF

# Запуск
node src/bot.js
```

## Структура

```
jarvis-bootstrap/
├── src/
│   ├── bot.js              # Главный файл — Telegram бот
│   ├── config.js           # Конфигурация из .env
│   ├── claude-session.js   # Управление сессиями Claude Code
│   ├── media.js            # Обработка медиа (вход/выход)
│   └── scheduler.js        # Таймеры и расписания
├── templates/
│   ├── workspace/
│   │   ├── SOUL.md         # Шаблон личности агента
│   │   ├── CLAUDE.md       # Шаблон правил и инструкций
│   │   └── MEMORY.md       # Шаблон памяти
│   └── skills/             # Навыки (claude code skills)
├── scripts/
│   └── bootstrap.sh        # Автоустановка на VPS
└── README.md
```

## Кастомизация

### Личность (SOUL.md)
Отредактируй `~/workspace/SOUL.md` — имя, тон, правила общения.

### Правила (CLAUDE.md)
`~/workspace/CLAUDE.md` — уровни автономности, безопасность, формат ответов.

### Навыки
Положи markdown в `~/workspace/.claude/skills/<name>/SKILL.md` — активируется автоматически.

### Переменные окружения
Добавляй в `~/.jarvis/.env`:
```
DEEPGRAM_API_KEY=...    # голосовые
GITHUB_TOKEN=...        # работа с репозиториями
SERPER_API_KEY=...      # веб-поиск
```

## Управление

```bash
# Статус
sudo systemctl status jarvis-bot

# Логи
sudo journalctl -u jarvis-bot -f

# Перезапуск
sudo systemctl restart jarvis-bot

# Обновление
cd ~/projects/jarvis-bootstrap && git pull && sudo systemctl restart jarvis-bot
```

## Требования

- Ubuntu 22.04+ (или Debian 12+)
- 2+ vCPU, 4GB+ RAM
- Node.js 22+
- Claude Code CLI
- Anthropic API Key (или Claude Max подписка)

## Лицензия

MIT
