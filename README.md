# Jarvis Bootstrap

Самодеплоящийся AI-агент в Telegram. Три движка на выбор: Claude Code, OpenAI Codex, Gemini CLI.

## Движки

| | Движок | Стоимость | Качество |
|---|---|---|---|
| 🆓 | Gemini CLI | Бесплатно (Google) | Хорошее |
| 💲 | OpenAI Codex | $20/мес (ChatGPT Plus) | Отличное |
| ⭐ | Claude Code | $100/мес (Claude Max) | Лучшее |

Все три движка работают с одними и теми же промптами, навыками и памятью.

## Быстрый старт

### Автоустановка (1 команда на VPS)

```bash
git clone https://github.com/sergeigeyn/jarvis-bootstrap.git /tmp/jb
sudo bash /tmp/jb/scripts/bootstrap.sh
```

Скрипт спросит:
1. **Движок** — Gemini (бесплатно) / Codex ($20) / Claude ($100)
2. **API Key** — ключ выбранного движка
3. **Bot Token** — от @BotFather
4. **Имя агента** и **твоё имя**
5. **Telegram ID** (опционально)
6. **Deepgram Key** (опционально, для голосовых)

### Ручная установка

```bash
# Node.js 22 + CLI
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# Выбери один из движков:
npm install -g @anthropic-ai/claude-code  # Claude
npm install -g @openai/codex              # Codex
npm install -g @google/gemini-cli         # Gemini

# Бот
git clone https://github.com/sergeigeyn/jarvis-bootstrap.git
cd jarvis-bootstrap && npm install

# Конфиг
mkdir -p ~/.jarvis
cat > ~/.jarvis/.env << EOF
ENGINE=claude
BOT_TOKEN=твой_токен
ANTHROPIC_API_KEY=sk-ant-...
AGENT_NAME=Джарвис
ADMIN_ID=твой_telegram_id
EOF

node src/bot.js
```

## Структура проекта

```
jarvis-bootstrap/
├── src/
│   ├── bot.js          # Telegram бот (grammy)
│   ├── config.js       # Конфигурация и .env
│   ├── engine.js       # Абстракция движков (Claude/Codex/Gemini)
│   ├── media.js        # Медиа: скачивание, транскрипция, маркеры
│   └── scheduler.js    # Таймеры и расписания
├── templates/
│   ├── workspace/      # SOUL.md, CLAUDE.md, MEMORY.md
│   └── skills/         # 5 встроенных навыков
├── scripts/
│   └── bootstrap.sh    # Автоустановка на VPS
└── docs/
    ├── architecture.md
    ├── customization.md
    └── troubleshooting.md
```

## Структура на сервере

```
~/
├── .jarvis/
│   ├── .env              # ENGINE + ключи (chmod 600)
│   └── schedules.json    # Расписания
├── workspace/
│   ├── SOUL.md           # Личность агента
│   ├── CLAUDE.md         # Правила работы
│   ├── MEMORY.md         # Долгосрочная память
│   ├── memory/           # Дневники
│   ├── knowledge/        # База знаний
│   └── .claude/skills/   # Навыки
└── projects/             # Рабочие проекты
```

## Документация

- **[Архитектура](docs/architecture.md)** — движки, модули, потоки данных
- **[Кастомизация](docs/customization.md)** — личность, правила, навыки, расписания
- **[Troubleshooting](docs/troubleshooting.md)** — решение проблем

## Управление

```bash
sudo systemctl status jarvis-bot      # статус
sudo journalctl -u jarvis-bot -f      # логи
sudo systemctl restart jarvis-bot     # перезапуск
```

## Смена движка

```bash
# Отредактируй ~/.jarvis/.env:
ENGINE=codex
OPENAI_API_KEY=sk-...

sudo systemctl restart jarvis-bot
```

## Требования

- Ubuntu 22.04+ / Debian 12+
- 2+ vCPU, 4GB+ RAM
- Node.js 22+

## Лицензия

MIT
