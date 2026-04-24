# Jarvis Bootstrap — Полный бриф проекта

## Что это

Open-source Telegram AI-агент, который пользователь ставит себе на VPS. Два движка на выбор (Claude Code, OpenAI Codex). Полноценная система: память, навыки, расписания, мониторинг, проекты, безопасность.

**Репо:** https://github.com/sergeigeyn/jarvis-bootstrap
**Стек:** Node.js 22, ES modules, grammy (Telegram), 2 зависимости. Без фреймворков, без TypeScript.
**Деплой:** systemd-сервис на VPS, автоустановка через Telegram-бот (helper-aishnik) или скрипт `scripts/bootstrap.sh`.

---

## Экосистема (3 проекта)

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  jarvis-bootstrap   │     │  helper-aishnik      │     │  dashboard (TODO)   │
│  AI-агент на VPS    │◀────│  Telegram installer  │────▶│  Веб-панель флота   │
│  github.com/sergei  │     │  wizard: 7 шагов     │     │  статусы, апдейты   │
│  geyn/jarvis-boots  │     │  Aeza + Timeweb      │     │  управление агентами│
│  trap               │     │  (локальный, без GH) │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

### 1. jarvis-bootstrap (этот проект)
Ядро — AI-агент. Пользователь общается с ним в Telegram. Код лежит на GitHub, деплоится на VPS пользователя.

### 2. helper-aishnik (installer bot)
Telegram-бот, который разворачивает jarvis-bootstrap на VPS за 5-15 минут. Wizard: выбор движка → API-ключ → VPS-провайдер → токен → бот-токен → подтверждение → деплой. Работает через SSH. Поддерживает Aeza Cloud и Timeweb Cloud. E2E протестирован на AlmaLinux 9.5.

**UX:** экран приветствия → чеклист 5 шагов → инлайн-инструкции (Claude $100/мес или API-ключ, токены Aeza/Timeweb, BotFather) → wizard деплоя.

**Статус:** код готов, E2E работает. Запускается вручную (`node src/bot.js`). НЕ на GitHub (только локально). Нужно: выложить на GitHub, сделать systemd-сервис, добавить auto-update и fleet management.

### 3. Dashboard (в разработке)
Веб-панель для управления всеми развёрнутыми агентами. Запускается на том же сервере что и helper-aishnik (188.166.90.33, DigitalOcean Amsterdam). Доступна по `http://188.166.90.33:4000`.

---

## Архитектура jarvis-bootstrap

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
                     │  monitor    │          │              │
                     │  config     │          │              │
                     └─────────────┘          └─────────────┘
```

### Модули (src/, 4454 строки, 13 файлов)

| Файл | Строк | Роль |
|------|-------|------|
| bot.js | 1034 | Telegram бот: команды, callback routing (menu/settings/projects/mon/action), батчинг сообщений (500мс), прогресс-статусы, очередь |
| settings.js | 1007 | Настройки: статус-карта, модель, env-менеджер, inline-кнопки |
| monitor.js | 607 | Мониторинг: RSS/GitHub/YouTube (все без API-ключей), inline UI, саммари через Haiku/GPT-4o-mini |
| engine.js | 414 | Абстракция CLI: Claude/Codex, stream-json парсинг, прогресс, retry, watchdog |
| projects.js | 252 | Проекты: список, пагинация, переключение, callback data по индексу |
| state.js | 227 | Персистентный стейт: сессии, расходы, режим, authMode |
| hooks.js | 208 | Безопасность: блок деструктивных команд, маскировка секретов, md→html |
| scheduler.js | 182 | Расписания (daily/weekly/once) + автопроверка мониторинга каждые 30 мин |
| media.js | 180 | Голос (Deepgram), фото, документы, медиа-маркеры |
| onboarding.js | 196 | Первый запуск: знакомство, профиль, версионирование шаблонов |
| trust.js | 108 | Уровень доверия (0-2) по количеству сессий |
| config.js | 64 | .env, определение движка и ключа |
| menu.js | 29 | Главное меню (8 inline-кнопок) |

### Документация (docs/)

| Файл | Содержание |
|------|------------|
| architecture.md | Слои, потоки данных, безопасность, фазы эволюции |
| customization.md | SOUL, CLAUDE, SERVICES, hooks, мониторинг, навыки, расписания, env-переменные |
| troubleshooting.md | Диагностика, проверка модулей, типичные проблемы |

### Шаблоны (templates/)

```
templates/
├── skills/ — 6 встроенных навыков (system, claude-api, feature-dev, frontend-design, mcp-builder, web-artifacts-builder)
└── workspace/ — SOUL.md, CLAUDE.md, CLAUDE.md, SERVICES.md, MEMORY.md (деплоятся в ~/workspace/)
```

Шаблоны содержат плейсхолдеры `{{AGENT_NAME}}` и `{{OWNER_NAME}}`. При деплое и обновлении подставляются реальные имена из `profile.json`.

**Версионирование:** `TEMPLATE_VERSION = 2` в `onboarding.js`. При `git pull + restart` бот сверяет версию шаблонов — если изменилась, автоматически применяет новые SOUL.md, CLAUDE.md и SERVICES.md. MEMORY.md никогда не перезаписывается.

---

## Что сделано (Фаза 1 + Фаза 2 = полностью завершены)

### Фаза 1: Ядро
- Telegram ↔ CLI обвязка, мульти-движок (Claude/Codex)
- Медиа: голос (Deepgram STT), фото, видео, документы, стикеры, аудио
- Батчинг входящих (500мс окно, параллельная обработка)
- Мгновенный прогресс (до запуска CLI): «Мозгую...», «Читаю файл», «Редактирую»
- Очередь сообщений при busy
- Инлайн-кнопки (Продолжай/Стоп/Комментарий) при лимите turns
- Код-гейты безопасности (hooks.js) — 16/16 протестировано
- Динамический trust level — 16/16 протестировано
- Онбординг, главное меню, настройки
- Проекты: список, пагинация, переключение
- Автодетект секретов во входящих сообщениях (11 типов)
- md→html конвертация, splitMessage с закрытием HTML-тегов

### Фаза 2: Паритет с IIA
- Персистентный стейт (state.json): сессии, расходы, режим
- stream-json парсинг: cost, sessionId, tool usage
- Cost tracking: dailySpendLimit ($50), auto-pause на 100%, alert на 80%
- Permission modes: auto/control/plan
- Auth mode: автодетект subscription vs api-key
- bypassPermissions + code-level guards
- Stale session recovery, error isolation
- Retry + watchdog (6 мин), graceful shutdown
- Scheduler: timezone-aware, hooks integration
- Мониторинг: RSS/GitHub/YouTube (все через публичные фиды, без API-ключей)
- Саммари: Haiku (Anthropic API), GPT-4o-mini (OpenAI API) или Haiku через OpenRouter — через ключ пользователя
- SERVICES.md — каталог сервисов в шаблонах (Deepgram, Voyage, GitHub, Railway, Vercel, Supabase, OpenRouter, Gemini)
- Версионирование шаблонов v2: SOUL.md + CLAUDE.md + SERVICES.md автообновляются при git pull + restart

---

## Критичные принципы (ошибки, которые были допущены)

### 1. Это ПРОДУКТ, не личный инструмент
**Ошибка:** Использование API-ключей из окружения разработчика (OPENROUTER_API_KEY) в коде продукта.
**Правило:** Код jarvis-bootstrap не может зависеть от ключей, которых нет у конечного пользователя. Пользователь добавляет свои ключи сам через /settings → 🔑. Если ключа нет — фича деградирует gracefully (без саммари, без приватных репо), а не падает.

### 2. Если можно без API — не требуй API
**Ошибка:** GitHub и YouTube мониторинг изначально требовали GITHUB_TOKEN и YOUTUBE_API_KEY.
**Правило:** Публичные RSS/Atom фиды работают без ключей. GitHub releases.atom, YouTube RSS feed — бесплатно и без регистрации. API-ключи только для расширенных функций (приватные репо, больше метаданных).

### 3. Callback data — 64 байта
**Ошибка:** Кириллические имена проектов в callback data кнопок. Кириллица = 2 байта в UTF-8. Имя > 32 символов = ошибка BUTTON_DATA_INVALID.
**Правило:** Использовать числовые индексы (`projects:s:0`) вместо имён.

### 4. Прогресс — мгновенно
**Ошибка:** Прогресс-сообщение отправлялось после запуска CLI (задержка 2-3с).
**Правило:** «Мозгую...» отправляется ДО запуска CLI. Пользователь видит реакцию мгновенно.

### 5. Безопасность — в коде, не в промптах
**Правило:** bypassPermissions + --disallowedTools + hooks.js = детерминистическая безопасность. Промпты (CLAUDE.md) — второй эшелон. Модель может нарушить промпт (~70% гарантия), код — нет (100%).

### 6. OAuth-токены подписки ≠ API-ключи
**Правило:** sk-ant-oat (OAuth) работает только через CLI. Нельзя вызвать Anthropic API напрямую. Фичи, зависящие от API (саммари), не работают для подписчиков без API-ключа.

---

## Что нужно сделать дальше

### Фаза 3: Проактивность
- [ ] Утренние/вечерние брифинги (scheduler + CLI)
- [ ] Авто-дайджесты по расписанию
- [ ] Авто-извлечение навыков из рабочих паттернов
- [ ] Changelog в боте (уведомления об обновлениях jarvis-bootstrap)

### Dashboard (веб-панель управления флотом)
Централизованная панель для оператора. Цель: видеть всех агентов, управлять ими, отслеживать подписки.

**Инфраструктура:**
- Сервер: 188.166.90.33 (DigitalOcean, Amsterdam) — тот же где helper-aishnik
- Стек: Node.js HTTP сервер (без фреймворков) + vanilla HTML/JS
- Данные: читает `data/deployments.json` напрямую (один сервер)
- Агенты: отдают статус через HTTP `/health` на порту 3000

**Архитектура:**
```
188.166.90.33:4000 (Dashboard)
  ├─▶ читает data/deployments.json (список агентов)
  ├─▶ GET http://<agent-ip>:3000/health (статус, версия, uptime)
  └─▶ кнопка "Обновить" → SSH через provisioner.js

Агент на VPS (85.x.x.x:3000/health)
  └─▶ { status, version, uptime, sessions_today }
```

**Минимальный функционал (MVP):**
- [ ] Таблица агентов: имя, IP, движок, статус online/offline, версия, дата подключения
- [ ] Дата подключения + поле subscription_end (для биллинга)
- [ ] Кнопка "Обновить" — git pull + restart на конкретном агенте
- [ ] Кнопка "Обновить всех"

**Расширенный функционал:**
- [ ] Uptime, память, диск (из /health)
- [ ] Количество сессий за день
- [ ] Логи агента (journalctl последние 50 строк)
- [ ] Уведомления в Telegram: агент упал, диск заканчивается

### Installer bot (helper-aishnik)
- [x] Выложить на GitHub — github.com/sergeigeyn/helper-aishnik
- [x] Auto-update развёрнутых агентов — команда /update (SSH → git pull + restart)
- [x] SSH-credentials сохраняются в store при деплое
- [ ] Сделать systemd-сервис — scripts/install-service.sh готов, нужно запустить
- [ ] Fleet management интеграция с dashboard'ом
- [ ] Дополнительные VPS-провайдеры (Hetzner, VDSina)

---

## Конфигурация на сервере пользователя

```
~/.jarvis/
├── .env              # ENGINE + ключи (chmod 600)
├── state.json        # Персистентный стейт
├── profile.json      # Профиль владельца
├── schedules.json    # Расписания
├── monitor.json      # Источники мониторинга
├── monitor/seen.json # Дедупликация
├── hooks.json        # Пользовательские хуки
├── trust.json        # Trust level
└── project.json      # Текущий проект

~/workspace/          # Идентичность и знания
├── SOUL.md           # Личность
├── CLAUDE.md         # Правила
├── SERVICES.md       # Каталог сервисов и API-ключей
├── MEMORY.md         # Память
├── memory/           # Дневник
├── knowledge/        # База знаний
└── .claude/skills/   # Навыки

~/projects/           # Рабочие проекты пользователя
```

---

## Движки

| Движок | CLI | Авторизация | Стоимость |
|--------|-----|------------|-----------|
| Claude Code | `claude` | ANTHROPIC_API_KEY или CLAUDE_CODE_OAUTH_TOKEN | $100/мес (Max) или API |
| OpenAI Codex | `codex` | OPENAI_API_KEY | $20/мес (Plus) или API |

Переключение: `/settings → Модель` или `ENGINE=` в `.env`. Автодетект OAuth vs API key.

---

## Команды бота

18 команд зарегистрированы через `setMyCommands`:

| Команда | Тип | Описание |
|---------|-----|----------|
| /start | Логика | Меню / онбординг |
| /newtask | Prompt → engine | Новая задача |
| /stop | Логика | Остановить задачу |
| /clear | Логика | Сбросить контекст |
| /undo | Prompt → engine | Отменить правку (git) |
| /project | Логика | Проекты (переключение) |
| /monitor | Логика | Мониторинг (inline UI) |
| /sources | Логика | Алиас для /monitor |
| /digest | Prompt → engine | Дайджест за день |
| /sessions | Prompt → engine | Активные сессии |
| /connect | Prompt → engine | VS Code туннель |
| /recovery | Prompt → engine | Аварийный SSH |
| /settings | Логика | Настройки |
| /status | Логика | Статус системы |
| /cost | Логика | Расходы за день |
| /skills | Prompt → engine | Навыки агента |
| /feedback | Prompt → engine | Отзыв |
| /help | Логика | Все команды |

---

## Зависимости

```json
{
  "grammy": "^1.41.1",
  "@grammyjs/auto-retry": "^2.0.2"
}
```

Минимализм — только Telegram SDK. Всё остальное (RSS-парсинг, stream-json, HTTP) — через встроенные API Node.js.

---

## Git

- 108 коммитов на main
- Формат коммитов: `[agent] action: описание`
- Нет открытых веток кроме main
- CI/CD нет — деплой через SSH (git pull + systemctl restart)
