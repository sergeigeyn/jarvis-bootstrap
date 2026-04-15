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

### "ANTHROPIC_API_KEY is required"
```bash
# Добавь ключ:
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
