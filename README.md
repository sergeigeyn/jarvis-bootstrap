# Jarvis Bootstrap

AI-агент в Telegram с тремя движками на выбор. Настраиваемая личность, память, навыки, расписания.

> **Автоматический деплой через Telegram?** Используй [jarvis-installer](https://github.com/sergeigeyn/jarvis-installer) — wizard-бот, который создаёт VPS и ставит агента за 5-15 минут.

## Движки

| | Движок | Стоимость | Качество |
|---|---|---|---|
| 🆓 | Gemini CLI | Бесплатно (Google) | Хорошее |
| 💲 | OpenAI Codex | $20/мес (ChatGPT Plus) | Отличное |
| ⭐ | Claude Code | $100/мес (Claude Max) | Лучшее |

Все три движка работают с одними промптами, навыками и памятью. Переключение — одна строка в `.env`.

## Установка

### Вариант 1: Через Telegram (рекомендуется)

Используй [@JarvisInstallerBot](https://github.com/sergeigeyn/jarvis-installer) — пошаговый wizard:
1. Выбери движок
2. Кинь API-токен VPS-провайдера (Timeweb Cloud)
3. Кинь Bot Token от @BotFather
4. Кинь API Key движка
5. Готово — агент в Telegram через 5-15 минут

### Вариант 2: Скрипт на VPS

```bash
git clone https://github.com/sergeigeyn/jarvis-bootstrap.git /tmp/jb
sudo bash /tmp/jb/scripts/bootstrap.sh
```

### Вариант 3: Ручная установка

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# Один из движков:
npm install -g @anthropic-ai/claude-code  # Claude
npm install -g @openai/codex              # Codex
npm install -g @google/gemini-cli         # Gemini

git clone https://github.com/sergeigeyn/jarvis-bootstrap.git
cd jarvis-bootstrap && npm install

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

## Как это работает

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram   │────▶│   bot.js         │────▶│  AI Engine      │
│   (grammy)   │◀────│   (Node.js)      │◀────│  CLI            │
└──────────────┘     └──────────────────┘     └─────────────────┘
                            │                        │
                     ┌──────┴──────┐          ┌──────┴──────┐
                     │  engine.js  │          │  workspace/  │
                     │  media.js   │          │  SOUL.md     │
                     │  scheduler  │          │  CLAUDE.md   │
                     └─────────────┘          │  skills/     │
                                              └─────────────┘
```

Бот принимает текст/голос/фото/файлы → вызывает CLI-агент → парсит ответ (медиа-маркеры) → отправляет в Telegram.

## Структура проекта

```
jarvis-bootstrap/
├── src/
│   ├── bot.js          # Telegram бот (grammy)
│   ├── config.js       # Конфигурация и .env
│   ├── engine.js       # Абстракция: Claude / Codex / Gemini
│   ├── media.js        # Медиа: Deepgram, маркеры [ФОТО:], [ФАЙЛ:]
│   └── scheduler.js    # Расписания (daily/weekly/once)
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
~/.jarvis/.env          # ENGINE + ключи (chmod 600)
~/.jarvis/schedules.json
~/workspace/SOUL.md     # Личность
~/workspace/CLAUDE.md   # Правила
~/workspace/MEMORY.md   # Память
~/workspace/memory/     # Дневники
~/workspace/knowledge/  # База знаний
~/workspace/.claude/skills/  # Навыки
~/projects/             # Рабочие проекты
```

## Документация

- [Архитектура](docs/architecture.md) — движки, модули, потоки данных, безопасность
- [Кастомизация](docs/customization.md) — личность, правила, навыки, расписания, переменные
- [Troubleshooting](docs/troubleshooting.md) — решение типичных проблем

## Управление

```bash
sudo systemctl status jarvis-bot      # статус
sudo journalctl -u jarvis-bot -f      # логи
sudo systemctl restart jarvis-bot     # перезапуск
```

## Смена движка

```bash
# ~/.jarvis/.env:
ENGINE=codex
OPENAI_API_KEY=sk-...

sudo systemctl restart jarvis-bot
```

## Связанные проекты

| Проект | Описание |
|---|---|
| [jarvis-bootstrap](https://github.com/sergeigeyn/jarvis-bootstrap) | Сам агент (этот репо) |
| [jarvis-installer](https://github.com/sergeigeyn/jarvis-installer) | Бот для автоматического деплоя через Telegram |

## Требования

- Ubuntu 22.04+ / Debian 12+
- 2+ vCPU, 4GB+ RAM
- Node.js 22+

## Лицензия

MIT
