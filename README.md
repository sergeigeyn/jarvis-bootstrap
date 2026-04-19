# Jarvis Bootstrap

AI-агент в Telegram с двумя движками на выбор. Настраиваемая личность, память, навыки, расписания.
Код-гейты безопасности, динамический trust level, эволюция через фазы.

> **Автоматический деплой через Telegram?** Используй [jarvis-installer](https://github.com/sergeigeyn/jarvis-installer) — wizard-бот, который создаёт VPS и ставит агента за 5-15 минут.

## Движки

| | Движок | Стоимость | Качество |
|---|---|---|---|
| 💲 | OpenAI Codex | $20/мес (ChatGPT Plus) | Отличное |
| ⭐ | Claude Code | $100/мес (Claude Max) или API | Лучшее (Opus 4.7) |

Оба движка работают с одними промптами, навыками и памятью. Переключение через `/settings → Модель` или `ENGINE=` в `.env`.

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
│   (grammy)   │◀────│   (Node.js)      │◀────│  CLI (stream)   │
└──────────────┘     └──────────────────┘     └─────────────────┘
                            │                        │
                     ┌──────┴──────┐          ┌──────┴──────┐
                     │  engine.js  │          │  workspace/  │
                     │  state.js   │          │  SOUL.md     │
                     │  media.js   │          │  CLAUDE.md   │
                     │  hooks.js   │          │  MEMORY.md   │
                     │  trust.js   │          │  skills/     │
                     │  scheduler  │          │  knowledge/  │
                     │  config     │          │  monitor     │
                     └─────────────┘          └─────────────┘
```

Бот принимает текст/голос/фото/файлы → **батчит сообщения** (500мс окно, параллельная загрузка медиа) → вызывает CLI-агент → **парсит stream-json в реальном времени** (прогресс-статусы) → **hooks проверяют ответ** → парсит медиа-маркеры → отправляет в Telegram.

Прогресс-статус появляется **мгновенно** (до запуска CLI): «🤔 Мозгую...», затем обновляется по мере работы: «Читаю файл 🌚 23с», «Редактирую 🌚 45с». Несколько сообщений подряд (текст, голос, фото) объединяются в один запрос. Если отправить новый запрос пока бот занят — покажет «⏳ в очереди» и обработает после.

После ответа — **футер** как `<blockquote>⏱ 35s · $0</blockquote>` в составе последнего сообщения. При подписке — `$0` (фиксированная плата, запросы бесплатны), при API key — реальная стоимость. Если агент упёрся в лимит turns (20+ из 25) — добавляются **инлайн-кнопки** (✔ Продолжай / ✖ Стоп / 💬 Комментарий).

## Команды

При запуске бот регистрирует полное меню через Telegram `setMyCommands`:

| Команда | Описание | Тип |
|---|---|---|
| `/start` | Приветствие / онбординг | Логика |
| `/newtask` | Новая задача | Prompt → engine |
| `/stop` | Остановить задачу | Логика |
| `/clear` | Сбросить контекст | Логика |
| `/undo` | Отменить правку (git) | Prompt → engine |
| `/project` | Переключить проект / меню | Логика |
| `/sessions` | Активные сессии | Prompt → engine |
| `/connect` | VS Code туннель | Prompt → engine |
| `/recovery` | Аварийный доступ к серверу | Prompt → engine |
| `/settings` | Настройки (inline-клавиатура) | Логика |
| `/status` | Статус системы | Логика |
| `/cost` | Расходы за день | Логика |
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
│   ├── engine.js       # Абстракция: Claude / Codex, stream-json парсинг
│   ├── state.js        # Персистентный стейт (сессии, расходы, режим)
│   ├── menu.js         # Главное меню (8 inline-кнопок)
│   ├── projects.js     # Проекты: список, пагинация, переключение
│   ├── onboarding.js   # Онбординг: профиль, знакомство, идентичность
│   ├── settings.js     # Настройки: статус-карта, модель, env-менеджер
│   ├── media.js        # Медиа: Deepgram, маркеры [ФОТО:], [ФАЙЛ:]
│   ├── hooks.js        # Код-гейты: блок команд, маскировка, детект секретов, md→html
│   ├── trust.js        # Динамический trust level (0→1→2)
│   └── scheduler.js    # Расписания (daily/weekly/once)
├── templates/
│   ├── workspace/      # SOUL.md, CLAUDE.md, MEMORY.md
│   └── skills/         # 6 встроенных навыков
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
├── state.json        # Персистентный стейт (сессия, расходы, режим)
├── profile.json      # Профиль владельца (имя, настройки)
├── schedules.json    # Расписания
├── hooks.json        # Пользовательские хуки (опционально)
├── trust.json        # Счётчик сессий и trust level
└── project.json      # Текущий проект

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

Три эшелона:

| Эшелон | Механизм | Гарантия |
|---|---|---|
| **engine.js** (код) | `--disallowedTools` — блокировка rm, sudo, kill, pkill, shutdown, reboot, mkfs, dd на уровне CLI | 100% |
| **engine.js** (код) | `bypassPermissions` + code-level guards — никаких интерактивных подтверждений в CLI | 100% |
| **hooks.js** (код) | Блокировка `rm -rf`, `DROP`, `push --force`; маскировка секретов в ответах; md→html с HTML entity escaping | 100% |
| **hooks.js** (код) | Детект секретов во входящих сообщениях (11 типов: API-ключи, токены, JWT, AWS, PEM) | 100% |
| **bot.js** (код) | Admin check на всех обработчиках включая callback-кнопки | 100% |
| **settings.js** (код) | Менеджер переменных + блоклист опасных (LD_PRELOAD, NODE_OPTIONS, PATH) | 100% |
| **onboarding.js** (код) | HTML-экранирование пользовательского ввода | 100% |
| **CLAUDE.md** (промпт) | GREEN/YELLOW/RED уровни автономности | ~70% |

Принцип: всё критичное — в коде. Промпт — подстраховка.
Переменные окружения хранятся в `~/.jarvis/.env` (chmod 600). Агент использует их через `$ИМЯ` в shell, не видит значений.

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

Через Telegram: `/settings` → Модель → выбери движок → следуй инструкции.

Или вручную в `~/.jarvis/.env`:
```bash
# Claude (подписка Max):
ENGINE=claude
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...

# Claude (API key):
ENGINE=claude
ANTHROPIC_API_KEY=sk-ant-...

# Codex:
ENGINE=codex
OPENAI_API_KEY=sk-...
```
```bash
sudo systemctl restart jarvis-bot
```

## Roadmap

### Готово
- [x] Multi-engine (Claude / Codex)
- [x] Telegram installer bot (Timeweb Cloud + Aéza Cloud)
- [x] E2E деплой через Aéza — AlmaLinux, мульти-дистрибутив
- [x] Код-гейты безопасности (hooks.js) — протестировано 16/16
- [x] Динамический trust level — протестировано 16/16
- [x] Онбординг — знакомство с владельцем при первом запуске
- [x] Главное меню с 8 inline-кнопками (menu.js)
- [x] Настройки: статус-карта, подключение, модель, режим (settings.js)
- [x] Проекты: список, пагинация, переключение (projects.js)
- [x] Полное меню команд (18 команд, setMyCommands)
- [x] Контекст личности — engine знает кто владелец и кто агент
- [x] OAuth-токен подписки (CLAUDE_CODE_OAUTH_TOKEN) + автодетект токенов
- [x] Предупреждение безопасности при отправке ключей в чат (11 типов секретов)
- [x] Admin check на callback-кнопках (защита от чужих пользователей)
- [x] Блоклист опасных env-переменных (LD_PRELOAD, NODE_OPTIONS)
- [x] HTML-экранирование пользовательского ввода
- [x] Прогресс-статусы (Мозгую, Читаю файл, Редактирую + таймер)
- [x] Мгновенный прогресс — статус до запуска CLI, без задержки
- [x] Очередь сообщений (⏳ в очереди при busy)
- [x] Батчинг входящих сообщений (500мс окно, параллельная обработка медиа)
- [x] Инлайн-кнопки после ответа (Далее / Стоп / Комментарий)
- [x] Проекты: сканирование подпапок workspace + создание в ~/projects/
- [x] Проекты: фильтрация системных проектов (bootstrap, installer, helper)
- [x] `/project name` — быстрое переключение проекта одной командой
- [x] Кнопки только при лимите turns (20+ из 25, не на каждый tool_use)
- [x] Обработка видео, стикеров, аудио (раньше игнорировались)
- [x] Авто-очистка медиафайлов (>24ч)
- [x] bot.catch() — graceful error handling
- [x] HTML fallback — стрипает теги при ошибке парсинга
- [x] Футер как blockquote (⏱ Ns) вместо plain text (🕐)
- [x] mdToHtml — HTML entity escaping, ссылки, авто-code для @mentions и файлов, [x] маркеры списков
- [x] splitMessage — корректное закрытие незакрытых HTML-тегов (closeOpenTags)
- [x] Голосовые — HTML-экранирование транскрипций
- [x] Стикеры через батчинг (как текст и медиа)

### Фаза 2: Паритет с IIA
- [x] **state.js** — персистентный стейт (state.json): сессии, расходы, режим, authMode
- [x] **stream-json** — парсинг CLI-вывода: cost, sessionId, tool usage
- [x] **Cost tracking** — costHistory по дням, dailySpendLimit ($50), auto-pause на 100%, alert на 80%
- [x] **Permission modes** — auto/control/plan с UI в settings, session reset при смене
- [x] **CLI args** — --max-turns 25, --allowedTools, --disallowedTools, --resume
- [x] **bypassPermissions** — CLI без интерактивных подтверждений, безопасность через code-level guards
- [x] **Stale session recovery** — авто-ретрай при протухшей сессии (No conversation found)
- [x] **Error isolation** — ошибки CLI не утекают как raw JSON в чат
- [x] **Auth mode** — автодетект subscription vs api-key, persist в state.json
- [x] **Opus 4.7** — дефолтная модель, 1M context, xhigh effort
- [x] **Retry + watchdog** — авто-ретрай транзиентных ошибок, watchdog на зависший CLI (6 мин)
- [x] **Graceful shutdown** — уведомление + kill CLI при перезапуске
- [x] **Scheduler hooks** — ответы расписаний через processResponse (маскировка, md→html, медиа)
- [x] **/clear sessionId** — полный сброс persistентной сессии
- [x] **costPaused авто-сброс** — автоматический сброс паузы при наступлении нового дня
- [x] **Scheduler timezone** — timezone-aware расписания через Intl.DateTimeFormat
- [x] **downloadFile** — проверка HTTP-статуса при скачивании файлов
- [x] **Typing-индикатор** — отправка после прогресса, 3с интервал, refresh после edit
- [x] **numTurns** — парсинг количества turns из stream-json для условия кнопок
- [x] **Цена всегда** — стоимость в футере независимо от authMode
- [x] **projects:switch** — сброс сессии (killSession + setSessionId) при переключении проекта
- [x] **projects:s:** — callback data по индексу (не имени) — фикс 64-byte лимита Telegram для кириллических имён
- [x] **Проекты UX** — читаемые имена на кнопках (без ~/workspace/ префикса), 2 в ряд, явное подтверждение переключения
- [ ] **Мониторинг** — YouTube, Twitter, GitHub, Telegram, RSS + storage backend

### Далее
- [ ] Changelog в боте (уведомления об обновлениях)
- [ ] Проактивный режим (утренние/вечерние брифинги)
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
