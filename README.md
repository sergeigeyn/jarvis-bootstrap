# Jarvis Bootstrap

Самодеплоящийся AI-агент: Telegram-бот на базе Claude Code CLI. Один скрипт — и у тебя личный AI-ассистент с памятью, навыками и полным доступом к серверу.

## Что это

Telegram-бот, который:
- Принимает текст, голосовые, фото, документы
- Обрабатывает через Claude Code CLI (файлы, shell, git, интернет)
- Отправляет ответ с медиа обратно в Telegram
- Имеет настраиваемую личность, правила и навыки
- Помнит контекст между сессиями (система памяти)
- Поддерживает расписания (daily/weekly/once)

## Быстрый старт

### Автоустановка на VPS (1 команда)

```bash
# На чистом Ubuntu 24.04 VPS, от root:
git clone https://github.com/OWNER/jarvis-bootstrap.git /tmp/jb
sudo bash /tmp/jb/scripts/bootstrap.sh
```

Скрипт спросит:
1. **Telegram Bot Token** — от [@BotFather](https://t.me/BotFather)
2. **Anthropic API Key** — с [console.anthropic.com](https://console.anthropic.com)
3. **Имя агента** (дефолт: Джарвис)
4. **Твоё имя** — как агент обращается к тебе
5. **Telegram ID** (опционально) — ограничить доступ
6. **Deepgram Key** (опционально) — для голосовых

### Ручная установка

```bash
# Node.js 22 + Claude Code CLI
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

## Структура проекта

```
jarvis-bootstrap/
├── src/
│   ├── bot.js              # Telegram бот (grammy)
│   ├── config.js           # Конфигурация из .env
│   ├── claude-session.js   # Сессии Claude Code CLI
│   ├── media.js            # Медиа: скачивание, транскрипция, маркеры
│   └── scheduler.js        # Таймеры и расписания
├── templates/
│   ├── workspace/
│   │   ├── SOUL.md         # Шаблон личности
│   │   ├── CLAUDE.md       # Шаблон правил
│   │   └── MEMORY.md       # Шаблон памяти
│   └── skills/             # 5 встроенных навыков
├── scripts/
│   └── bootstrap.sh        # Автоустановка на VPS
├── docs/
│   ├── architecture.md     # Архитектура и потоки данных
│   ├── customization.md    # Кастомизация всего
│   └── troubleshooting.md  # Решение проблем
└── README.md
```

## Структура на сервере после установки

```
~/
├── .jarvis/
│   ├── .env                # API ключи (chmod 600)
│   └── schedules.json      # Расписания
├── workspace/
│   ├── SOUL.md             # Личность агента
│   ├── CLAUDE.md           # Правила работы
│   ├── MEMORY.md           # Долгосрочная память
│   ├── memory/             # Дневники (YYYY-MM-DD.md)
│   ├── knowledge/          # База знаний
│   ├── .media/             # Скачанные медиа
│   └── .claude/skills/     # Навыки
└── projects/               # Рабочие проекты
```

## Документация

- **[Архитектура](docs/architecture.md)** — как работает, модули, поток данных, безопасность
- **[Кастомизация](docs/customization.md)** — личность, правила, навыки, расписания, переменные
- **[Troubleshooting](docs/troubleshooting.md)** — решение типичных проблем

## Управление

```bash
sudo systemctl status jarvis-bot     # статус
sudo journalctl -u jarvis-bot -f     # логи в реалтайме
sudo systemctl restart jarvis-bot    # перезапуск
```

## Обновление

```bash
cd ~/projects/jarvis-bootstrap
git pull origin main
npm install
sudo systemctl restart jarvis-bot
```

## Команды в Telegram

| Команда | Описание |
|---|---|
| `/start` | Приветствие |
| `/reset` | Сброс сессии Claude |
| `/status` | Статус текущей сессии |

Всё остальное — свободная переписка. Агент понимает текст, голос, фото, файлы.

## Требования

- Ubuntu 22.04+ / Debian 12+
- 2+ vCPU, 4GB+ RAM
- Node.js 22+
- Anthropic API Key

## Лицензия

MIT
