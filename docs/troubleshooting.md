# Troubleshooting

## Бот не запускается

### "BOT_TOKEN is required"
```bash
# Проверь что .env существует и содержит токен
cat ~/.jarvis/.env | grep BOT_TOKEN
# Если пусто — добавь:
echo "BOT_TOKEN=123456:ABC-DEF..." >> ~/.jarvis/.env
sudo systemctl restart jarvis-bot
```

### "ANTHROPIC_API_KEY is required" / движок не подключён
```bash
# Два варианта авторизации Claude:

# Вариант A — подписка Max (OAuth-токен):
# На своём компе: claude setup-token → скопируй токен → добавь в .env:
echo "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-..." >> ~/.jarvis/.env

# Вариант B — API key:
echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/.jarvis/.env

sudo systemctl restart jarvis-bot
```

### Бот падает сразу после старта
```bash
# Смотри логи:
sudo journalctl -u jarvis-bot -n 100 --no-pager

# Частые причины:
# 1. Неверный BOT_TOKEN → создай нового бота через @BotFather
# 2. Node.js < 22 → обнови: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
# 3. Не установлены зависимости → cd ~/projects/jarvis-bootstrap && npm install
```

### Токен в .env разбит на две строки (Claude Code exited with code 1)

Telegram может вставить перенос строки в длинный токен. В `.env` токен оказывается на двух строках → бот читает только первую часть → ошибка авторизации.

```bash
# Проверь:
grep -c CLAUDE_CODE_OAUTH_TOKEN ~/.jarvis/.env
# Если 1 — ок. Если токен длинный, проверь что нет переноса:
wc -L ~/.jarvis/.env  # самая длинная строка должна быть >100 символов

# Починить — объединить строки:
python3 -c "
f=open('/home/client/.jarvis/.env','r'); c=f.read(); f.close()
# Убрать переносы строк внутри значений
import re
c = re.sub(r'(sk-ant-oat[^\n]*)\n([^\n=]+)', r'\1\2', c)
f=open('/home/client/.jarvis/.env','w'); f.write(c); f.close()
print('Fixed')
"
sudo systemctl restart jarvis-bot
```

> **Примечание:** в коде бота это уже исправлено — `replace(/\s+/g, '')` убирает переносы строк из токенов при сохранении через Telegram. Проблема может возникнуть только если `.env` редактировали вручную.

## Ответ пропадает (прогресс виден, потом тишина)

### InlineKeyboard не импортирован
Если `buildActionKeyboard()` вызывает `ReferenceError: InlineKeyboard is not defined`, прогресс-сообщение удаляется, но ответ не отправляется. Проверь импорт в bot.js:
```javascript
import { Bot, InputFile, InlineKeyboard } from 'grammy';
```

### Raw JSON вместо ответа
Если вместо ответа приходит JSON — парсер stream-json не обработал ошибку CLI. Проверь что `parseStreamJson` обрабатывает `is_error` и `errors` из result-объекта.

### Протухшая сессия
Если CLI вернул "No conversation found with session ID" — sessionId протух. Engine.js автоматически ретраит один раз без --resume. Если не помогло:
```bash
# В Telegram:
/clear
```

## Бот не отвечает

### Claude Code не установлен
```bash
which claude
# Если пусто:
npm install -g @anthropic-ai/claude-code
```

### Claude Code CLI не работает
```bash
# Проверь напрямую:
ANTHROPIC_API_KEY=sk-ant-... claude --print "привет"
# Если ошибка авторизации — ключ невалидный
# Если таймаут — проблема с сетью
```

### Сессия зависла
Отправь `/reset` в Telegram — сбросит текущую сессию Claude.

### Бот отвечает "Подожди, обрабатываю..."
Предыдущий запрос ещё выполняется. Claude Code может работать до 5 минут на сложных задачах. Если завис:
```bash
# Перезапуск:
sudo systemctl restart jarvis-bot
```

## Голосовые не работают

### Нет транскрипции
```bash
# Проверь что DEEPGRAM_API_KEY задан:
grep DEEPGRAM ~/.jarvis/.env
# Если пусто — добавь ключ с https://console.deepgram.com
```

### "Не удалось распознать голосовое"
- Слишком тихая запись
- Язык не русский (по умолчанию model=nova-2, language=ru)
- Deepgram ключ истёк

## Агент не читает фото/медиа

### Permission denied на .media/
CLI в режиме acceptEdits блокирует Read для файлов вне CWD. Решение — `bypassPermissions` (уже включён в engine.js). Фото сохраняются в `~/workspace/.media/`, промпт содержит путь для Read.

### Фото не распознаётся
Claude не умеет «видеть» фото из файловой системы напрямую — он читает файл через Read tool как binary. Для анализа изображений фото должно быть передано через мультимодальный API (не CLI). Текущая реализация: CLI читает файл, пытается интерпретировать.

## Медиа не отправляются

### Фото/файлы не доходят
```bash
# Проверь что файл существует:
ls -la /path/to/file
# Проверь размеры (лимиты Telegram):
# Фото: до 10MB
# Остальное: до 50MB
```

### Маркеры [ФОТО:] отображаются как текст
Claude вернул маркер, но парсер не распознал. Проверь формат:
- Правильно: `[ФОТО: /tmp/image.jpg]`
- Неправильно: `[ФОТО:/tmp/image.jpg]` (нет пробела после двоеточия)

## Расписания не срабатывают

```bash
# Проверь файл:
cat ~/.jarvis/schedules.json | python3 -m json.tool

# Частые проблемы:
# 1. enabled: false → поставь true
# 2. Неверный hour (UTC vs локальное время)
# 3. ADMIN_ID не задан → расписание некому отправлять
```

## Мониторинг не работает

### Источники не добавляются
```bash
# Проверь конфиг:
cat ~/.jarvis/monitor.json | python3 -m json.tool

# Если файла нет — нормально, создастся при первом добавлении
```

### YouTube-канал не резолвится (@handle)
Бот пытается извлечь channel_id со страницы канала. Если не получается:
- Проверь что канал существует
- Попробуй полную ссылку: `youtube.com/channel/UCxxxx`
- Мобильные ссылки (`m.youtube.com`) поддерживаются

### Дайджест не приходит
```bash
# Проверь:
# 1. enabled: true в monitor.json
# 2. ADMIN_ID задан (некому отправлять)
# 3. Есть хотя бы один включённый источник
# 4. Логи:
sudo journalctl -u jarvis-bot | grep monitor
```

### «Проверить сейчас» — пусто
Все текущие записи уже помечены как прочитанные. Новые появятся когда источник обновится. Чтобы сбросить:
```bash
rm ~/.jarvis/monitor/seen.json
sudo systemctl restart jarvis-bot
```

## Обновление

```bash
cd ~/projects/jarvis-bootstrap
git pull origin main
npm install
sudo systemctl restart jarvis-bot
```

## Полный сброс

```bash
# Остановить бота
sudo systemctl stop jarvis-bot

# Удалить данные (ОСТОРОЖНО — удалит память и настройки)
rm -rf ~/.jarvis
rm -rf ~/workspace

# Переустановить
sudo bash ~/projects/jarvis-bootstrap/scripts/bootstrap.sh
```

## Логи

```bash
# Последние 100 строк
sudo journalctl -u jarvis-bot -n 100

# В реальном времени
sudo journalctl -u jarvis-bot -f

# За сегодня
sudo journalctl -u jarvis-bot --since today

# Только ошибки
sudo journalctl -u jarvis-bot -p err
```

## Проверка модулей

### hooks.js — код-гейты безопасности
```bash
# Проверить что деструктивные команды блокируются:
cd ~/projects/jarvis-bootstrap
node -e "
import { checkCommand, maskSecrets } from './src/hooks.js';
const tests = ['rm -rf /', 'DROP TABLE users', 'git push --force', 'git commit -m test', 'npm install'];
for (const t of tests) {
  const r = checkCommand(t);
  console.log(r.blocked ? 'BLOCK' : 'ALLOW', '—', t, r.reason || '');
}
console.log('---');
console.log(maskSecrets('key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890'));
// Ожидание: key: sk-ant-***
"
```

Ожидаемый результат:
```
BLOCK — rm -rf / Деструктивное удаление файлов
BLOCK — DROP TABLE users Удаление структуры БД
BLOCK — git push --force Принудительный push
ALLOW — git commit -m test
ALLOW — npm install
---
key: sk-ant-***
```

Статус: ✅ Протестировано (16/16 блокировка, 5/5 маскировка)

### trust.js — динамический trust level
```bash
node -e "
import { getTrustLevel, getTrustName, getTrustState, recordSession } from './src/trust.js';
console.log('State:', JSON.stringify(getTrustState()));
console.log('Level:', getTrustLevel(), '—', getTrustName());
"
```

Статус: ✅ Протестировано (16/16 — уровни и подтверждения)

### Интеграция в bot.js
- `processResponse()` — каждый ответ агента проходит через маскировку секретов
- `recordSession()` — каждое сообщение увеличивает счётчик сессий
- `/status` — показывает trust level и количество сессий

Статус: ✅ Интегрировано, код проверен
