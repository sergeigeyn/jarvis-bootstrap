# Jarvis Bootstrap

AI-агент в Telegram с тремя движками на выбор. Настраиваемая личность, память, навыки, расписания.
Код-гейты безопасности, динамический trust level, эволюция через фазы.

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
                     │  hooks.js   │          │  CLAUDE.md   │
                     │  trust.js   │          │  skills/     │
                     │  scheduler  │          │  knowledge/  │
                     └─────────────┘          └─────────────┘
```

Бот принимает текст/голос/фото/файлы → вызывает CLI-агент → **hooks проверяют ответ** → парсит медиа-маркеры → отправляет в Telegram.

## Команды

При запуске бот регистрирует полное меню через Telegram `setMyCommands`:

| Команда | Описание | Тип |
|---|---|---|
| `/start` | Приветствие / онбординг | Логика |
| `/newtask` | Новая задача | Prompt → engine |
| `/stop` | Остановить задачу | Логика |
| `/clear` | Сбросить контекст | Логика |
| `/undo` | Отменить правку (git) | Prompt → engine |
| `/projects` | Список проектов | Prompt → engine |
| `/sessions` | Активные сессии | Prompt → engine |
| `/connect` | VS Code туннель | Prompt → engine |
| `/recovery` | Аварийный доступ к серверу | Prompt → engine |
| `/settings` | Настройки (inline-клавиатура) | Логика |
| `/status` | Статус системы | Логика |
| `/cost` | Расходы за день | Prompt → engine |
| `/monitor` | Статус мониторинга | Prompt → engine |
| `/digest` | Дайджест контента | Prompt → engine |
| `/sources` | Каналы и аккаунты | Prompt → engine |
| `/skills` | Навыки агента | Prompt → engine |
| `/feedback` | Отзыв | Prompt → engine |
| `/help` | Все команды | Логика |

**Логика** — обработчик в `bot.js`. **Prompt → engine** — структурированный промпт в CLI, engine сам разберётся через tools.

## Структура проекта

```
jarvis-bootstrap/
├── src/
│   ├── bot.js          # Telegram бот (grammy), команды, роутинг
│   ├── config.js       # Конфигурация и .env
│   ├── engine.js       # Абстракция: Claude / Codex / Gemini
│   ├── onboarding.js   # Онбординг: профиль, знакомство, идентичность
│   ├── settings.js     # Меню настроек (inline-клавиатура)
│   ├── media.js        # Медиа: Deepgram, маркеры [ФОТО:], [ФАЙЛ:]
│   ├── hooks.js        # Код-гейты: блок деструктивных команд, маскировка секретов
│   ├── trust.js        # Динамический trust level (0→1→2)
│   └── scheduler.js    # Расписания (daily/weekly/once)
├── templates/
│   ├── workspace/      # SOUL.md, CLAUDE.md, MEMORY.md
│   └── skills/         # 5 встроенных навыков
├── scripts/
│   └── bootstrap.sh    # Автоустановка на VPS (мульти-дистрибутив)
└── docs/
    ├── architecture.md # Слои, потоки, безопасность, эволюция
    ├── customization.md # SOUL, CLAUDE, hooks, trust, навыки, расписания
    └── troubleshooting.md
```

## Структура на сервере

```
~/.jarvis/
├── .env              # ENGINE + ключи (chmod 600)
├── profile.json      # Профиль владельца (имя, настройки)
├── schedules.json    # Расписания
├── hooks.json        # Пользовательские хуки (опционально)
└── trust.json        # Счётчик сессий и trust level

~/workspace/
├── SOUL.md           # Личность (кто)
├── CLAUDE.md         # Правила (как)
├── MEMORY.md         # Память (что знает)
├── memory/           # Дневники
├── knowledge/        # База знаний
└── .claude/skills/   # Навыки

~/projects/           # Рабочие проекты
```

## Безопасность

Два эшелона:

| Эшелон | Механизм | Гарантия |
|---|---|---|
| **hooks.js** (код) | Блокировка `rm -rf`, `DROP`, `push --force`; маскировка секретов | 100% |
| **CLAUDE.md** (промпт) | GREEN/YELLOW/RED уровни автономности | ~70% |

Принцип: всё критичное — в коде. Промпт — подстраховка.

## Trust Level

Агент «взрослеет» с количеством сессий:

| Уровень | Сессий | Поведение |
|---|---|---|
| 0 — новичок | 0-10 | Подтверждает YELLOW и RED |
| 1 — знакомый | 11-50 | Подтверждает только RED |
| 2 — доверенный | 51+ | Подтверждает только критичные RED |

Можно задать вручную: `TRUST_LEVEL=2` в `.env`.

## Документация

- [Архитектура](docs/architecture.md) — слои, движки, потоки, безопасность, эволюция
- [Кастомизация](docs/customization.md) — личность, правила, хуки, trust, навыки, расписания
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

## Roadmap

- [x] Multi-engine (Claude / Codex / Gemini)
- [x] Telegram installer bot (Timeweb Cloud + Aéza Cloud)
- [x] E2E деплой через Aéza — AlmaLinux, мульти-дистрибутив
- [x] Код-гейты безопасности (hooks.js) — протестировано 16/16
- [x] Динамический trust level — протестировано 16/16
- [x] Онбординг — знакомство с владельцем при первом запуске
- [x] Меню настроек (inline-клавиатура, /settings)
- [x] Полное меню команд (18 команд, setMyCommands)
- [x] Контекст личности — engine знает кто владелец и кто агент
- [ ] Changelog в боте (уведомления об обновлениях)
- [ ] Проактивный режим (утренние/вечерние сканы)
- [ ] Авто-извлечение навыков из паттернов
- [ ] Оплата (ЮKassa, Stripe)
- [ ] Дополнительные VPS-провайдеры (Hetzner, VDSina)
- [ ] Fleet management (мониторинг/обновление развёрнутых агентов)
- [ ] Мульти-агенты, A2A протокол

## Связанные проекты

| Проект | Описание |
|---|---|
| [jarvis-bootstrap](https://github.com/sergeigeyn/jarvis-bootstrap) | Сам агент (этот репо) |
| [jarvis-installer](https://github.com/sergeigeyn/jarvis-installer) | Бот для деплоя через Telegram |

## Требования

- Ubuntu 22.04+ / Debian 12+ / AlmaLinux 9+ / RHEL 9+ / Alpine
- 1+ vCPU, 2GB+ RAM (минимум), 2+ vCPU, 4GB+ рекомендуется
- Node.js 22+

## Лицензия

MIT
