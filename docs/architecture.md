# Архитектура

## Обзор

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram   │────▶│   bot.js         │────▶│  AI Engine      │
│   (grammy)   │◀────│   (Node.js)      │◀────│  CLI            │
└──────────────┘     └──────────────────┘     └─────────────────┘
                            │                        │
                     ┌──────┴──────┐          ┌──────┴──────┐
                     │  media.js   │          │  workspace/  │
                     │  scheduler  │          │  SOUL.md     │
                     │  config     │          │  CLAUDE.md   │
                     │  engine     │          │  skills/     │
                     └─────────────┘          └─────────────┘
```

## Поддерживаемые движки

| Движок | CLI | Стоимость | Установка |
|---|---|---|---|
| Claude Code | `claude` | $100/мес (Max) или API | `npm i -g @anthropic-ai/claude-code` |
| OpenAI Codex | `codex` | $20/мес (Plus) или API | `npm i -g @openai/codex` |
| Gemini CLI | `gemini` | Бесплатно (Google) | `npm i -g @google/gemini-cli` |

Выбор движка через `ENGINE=claude|codex|gemini` в `.env`.

## Поток сообщения

1. **Входящее** → Telegram update → grammy
2. **Предобработка** → определение типа (текст/голос/фото/документ)
   - Голос: скачивание → Deepgram транскрипция → текст
   - Фото/документ: скачивание → путь в промпт
3. **Engine** → spawn CLI-процесса:
   - Claude: `claude --print --output-format text <prompt>`
   - Codex: `codex --full-auto --quiet <prompt>`
   - Gemini: `gemini --noinput <prompt>`
4. **Постобработка** → парсинг медиа-маркеров `[ФОТО:]`, `[ФАЙЛ:]`
5. **Исходящее** → медиа + текст → Telegram

## Модули

### config.js
Загрузка `.env`, определение движка и API-ключа, валидация.

### engine.js
Абстракция над тремя CLI-агентами. Единый интерфейс `send(prompt)` → `onDone(response)`. Управление сессиями, таймаутами, очисткой.

### media.js
Скачивание файлов из Telegram, транскрипция через Deepgram, парсинг медиа-маркеров в ответах.

### scheduler.js
Расписания (daily/weekly/once) из `schedules.json`. Выполнение через текущий движок.

### bot.js
Telegram бот (grammy): команды, обработчики сообщений, typing индикатор, разбивка длинных ответов.

## Безопасность

- **ADMIN_ID** — ограничение доступа одним пользователем
- **.env chmod 600** — ключи доступны только владельцу
- **SOUL.md/CLAUDE.md** — инструкции не показывать ключи
- **GREEN/YELLOW/RED** — три уровня автономности
