# Сервисы и возможности

## Что работает из коробки

Ассистент работает на Claude Code (подписка Anthropic). Основные возможности доступны сразу:

- Поиск в интернете — встроенный поиск Anthropic (хорош для технических запросов)
- Чтение веб-страниц — парсинг любых URL, документация, статьи, GitHub-репозитории
- Работа с файлами — чтение, создание, редактирование любых файлов
- Код — написание, рефакторинг, дебаг на любом языке
- Git — коммиты, ветки, диффы, история
- Анализ изображений — распознавание скриншотов, диаграмм, фото
- Shell — выполнение команд, установка пакетов, сборка проектов
- npm/pip/cargo — установка зависимостей, запуск проектов

Ничего настраивать не нужно — просто пиши задачу.

---

## Дополнительные сервисы

Каждый сервис расширяет возможности ассистента. Подключай по мере необходимости через <b>/settings → 🔑 Переменные окружения</b>.

### 1. Голосовые сообщения — DEEPGRAM_API_KEY

Без этого ключа голосовые сообщения не распознаются.

- Где взять: https://console.deepgram.com → Sign Up → API Keys
- Стоимость: $200 бесплатных кредитов при регистрации. Потом ~$0.004/мин
- Как добавить: /settings → Переменные окружения → имя: DEEPGRAM_API_KEY, значение: ключ
- Результат: голосовые начнут распознаваться сразу

---

### 2. Семантическая память — VOYAGE_API_KEY

Умный поиск по заметкам и базе знаний. Без ключа работает текстовый поиск.

- Где взять: https://dash.voyageai.com → Sign Up → API Keys
- Стоимость: $0.02 за 1M токенов (очень дёшево). Бесплатный tier есть
- Как добавить: /settings → Переменные окружения → имя: VOYAGE_API_KEY, значение: ключ
- Результат: поиск по памяти и заметкам станет семантическим — понимает смысл, а не только слова

---

### 3. GitHub — GITHUB_TOKEN

Доступ к репозиториям, управление issues/PRs, деплой через GitHub Actions.

Оба типа токенов сохраняются как <code>$GITHUB_TOKEN</code>. Достаточно одного:

<b>Fine-grained token (рекомендуем)</b> — доступ только к выбранным репо:
- Где взять: https://github.com/settings/tokens?type=beta → Generate new token
- Repository access: Only select repositories → выбрать нужные
- Repository permissions: Contents (Read+Write), Pull requests (Read+Write)
- Формат: <code>github_pat_...</code>

<b>Classic token</b> — доступ ко всем репо:
- Где взять: https://github.com/settings/tokens/new
- Scopes: repo (первый чекбокс)
- Формат: <code>ghp_...</code>

- Стоимость: бесплатно
- Как добавить: /settings → GitHub

---

### 4. Railway — RAILWAY_TOKEN

Деплой проектов в облако. Проще всего задеплоить бэкенд, бот, API или cron-задачу.

Оба типа токенов сохраняются как <code>$RAILWAY_TOKEN</code>. Достаточно одного:

<b>Токен проекта (рекомендуем)</b> — доступ только к одному проекту:
- Где взять: railway.app → Проект → Settings → Tokens → Create Project Token
- Формат: UUID (<code>xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>)
- Заголовок: <code>Project-Access-Token: $RAILWAY_TOKEN</code>
- ⚠️ Токен уже привязан к проекту — не передавай projectId для авторизации
- ⚠️ Railway CLI с ним не работает — только API

<b>Токен аккаунта</b> — полный доступ ко всем проектам:
- Где взять: railway.app → Account Settings → Tokens → Create Token
- Заголовок: <code>Authorization: Bearer $RAILWAY_TOKEN</code>
- Работает с Railway CLI

<b>Project ID</b> (<code>$RAILWAY_PROJECT_ID</code>) — нужен как значение в запросах:
- Где взять: railway.app → Проект → Settings → General → Project ID

- Стоимость: $5/мес (Hobby plan). Pay-as-you-go за ресурсы

Что можно деплоить: Telegram-боты, API/бэкенды (Node.js, Python, Go), cron-задачи, базы данных (PostgreSQL, Redis).

Railway API (GraphQL): <code>https://backboard.railway.app/graphql/v2</code>

---

### 5. Vercel — VERCEL_TOKEN

Деплой сайтов, Next.js, serverless-функций.

- <b>VERCEL_TOKEN</b> — токен доступа к API и CLI
  - Где взять: https://vercel.com/account/tokens → Create Token
- <b>VERCEL_PROJECT_ID</b> — ограничивает агента одним проектом
  - Где взять: vercel.com → Проект → Settings → General → Project ID
  - Формат: <code>prj_xxxxxxxxxxxxxxxx</code>
  - Если указан — агент деплоит только в этот проект

- Стоимость: бесплатный tier для хобби-проектов
- Безопасность: деплой = RED-операция, агент спросит подтверждение

---

### 6. Supabase — база данных

PostgreSQL + REST API + Auth + Storage.

- <b>SUPABASE_URL</b> — адрес проекта (<code>https://xxx.supabase.co</code>). Где взять: ⚙️ Project Settings → Data API → Project URL
- <b>SUPABASE_ANON_KEY</b> — публичный ключ (с RLS). Где взять: ⚙️ Project Settings → API Keys → anon public
- <b>SUPABASE_SERVICE_KEY</b> — полный доступ, обходит RLS. Где взять: ⚙️ Project Settings → API Keys → service_role
- <b>SUPABASE_ACCESS_TOKEN</b> — для CLI (миграции, edge functions). Где взять: аватарка → Account Settings → Access Tokens

Стоимость: бесплатный tier (2 проекта). Pro $25/мес.

Примеры curl:
<pre># Чтение (anon key — с RLS)
curl -s "$SUPABASE_URL/rest/v1/table_name" \
  -H "apikey: $SUPABASE_ANON_KEY"

# Запись (service key — полный доступ)
curl -s "$SUPABASE_URL/rest/v1/table_name" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "test", "value": 42}'</pre>

---

### 7. OpenRouter — OPENROUTER_API_KEY

Доступ к разным LLM через единый API (GPT-4, Gemini, Llama, Mistral). Полезно для задач где нужна другая модель или дешёвый batch.

- Где взять: https://openrouter.ai → Sign Up → Keys
- Стоимость: pay-per-token, зависит от модели
- Как добавить: /settings → Переменные окружения → имя: OPENROUTER_API_KEY

Использование:
<pre>curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "anthropic/claude-haiku-4-5", "messages": [{"role": "user", "content": "hi"}]}'</pre>

---

### 8. Google AI Studio — GOOGLE_API_KEY / GEMINI_API_KEY

Доступ к моделям Google (Gemini Pro, Flash).

- Где взять: https://aistudio.google.com → Get API key
- Стоимость: бесплатный tier (60 запросов/мин). Платно при высоких объёмах
- Как добавить: /settings → Переменные окружения → имя: GOOGLE_API_KEY

---

### Любой другой сервис с REST API

Ассистент работает с любым сервисом у которого есть REST API.

- Добавь ключ через /settings → Переменные окружения (например: <code>NOTION_API_KEY</code>, <code>STRIPE_SECRET_KEY</code>)
- Ассистент увидит ключ и сможет использовать через <code>curl</code> или shell
- Если не знаешь как подключить — спроси, найдёт документацию и настроит

---

## Паттерны аутентификации

| Сервис | Заголовок |
|---|---|
| Anthropic, OpenRouter | <code>x-api-key: $KEY</code> |
| OpenAI, GitHub, Vercel | <code>Authorization: Bearer $TOKEN</code> |
| Railway (project token) | <code>Project-Access-Token: $TOKEN</code> |
| Supabase | <code>apikey: $KEY</code> |
| Google/Gemini | <code>?key=$KEY</code> в URL |

Проверка наличия ключа: <code>printenv ИМЯ</code> (не echo — он возвращает пустоту через pipe).

---

## Память и заметки

Работает через файловую систему, настройка не нужна:

- <b>MEMORY.md</b> — долгосрочная память (факты, предпочтения). Ассистент дополняет автоматически
- <b>memory/YYYY-MM-DD.md</b> — дневник (задачи, прогресс за день)
- <b>knowledge/</b> — база знаний (архитектура, решения, конфиги)

Чтобы ассистент что-то запомнил — скажи «запомни это».

---

## Статус сервисов

Спроси ассистента: «Какие сервисы настроены?» — проверит переменные окружения и покажет.
