// Система таймеров/расписаний
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from './config.js';
import { getSession } from './engine.js';
import { processResponse } from './hooks.js';
import { parseMediaMarkers, sendMedia } from './media.js';
import { getTimezone } from './state.js';
import { loadMonitorConfig, checkAllSources, formatDigest } from './monitor.js';

let schedules = [];
let timers = new Map();

export function loadSchedules() {
  if (existsSync(config.schedulesPath)) {
    try {
      schedules = JSON.parse(readFileSync(config.schedulesPath, 'utf8'));
    } catch {
      schedules = [];
    }
  }
  return schedules;
}

export function saveSchedules() {
  writeFileSync(config.schedulesPath, JSON.stringify(schedules, null, 2));
}

function getNowInTz() {
  const tz = getTimezone();
  const now = new Date();
  // Парсим компоненты через Intl для точного timezone
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
  }).formatToParts(now).forEach(p => { parts[p.type] = p.value; });
  const hour = parseInt(parts.hour, 10) % 24; // "24" → 0
  const minute = parseInt(parts.minute, 10);
  const dayMap = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = dayMap[parts.weekday] || (now.getDay() || 7);
  return { now, hour, minute, weekday };
}

function shouldRunNow(schedule) {
  const { now, hour, minute, weekday } = getNowInTz();
  
  if (!schedule.enabled) return false;
  
  if (schedule.type === 'daily') {
    return hour === schedule.hour && (schedule.minute ?? 0) === minute;
  }
  
  if (schedule.type === 'weekly') {
    return hour === schedule.hour 
      && (schedule.minute ?? 0) === minute
      && schedule.weekdays?.includes(weekday);
  }
  
  if (schedule.type === 'once') {
    const target = new Date(schedule.at);
    return Math.abs(now - target) < 60_000; // в пределах минуты
  }
  
  return false;
}

export function startScheduler(bot) {
  loadSchedules();
  
  // Проверяем каждую минуту
  setInterval(async () => {
    const now = new Date();
    
    for (const schedule of schedules) {
      if (!shouldRunNow(schedule)) continue;
      
      // Не запускать чаще раза в час (защита от дублей)
      if (schedule.lastRunAt) {
        const lastRun = new Date(schedule.lastRunAt);
        if (now - lastRun < 3600_000) continue;
      }
      
      console.log(`[scheduler] running: ${schedule.name}`);
      schedule.lastRunAt = now.toISOString();
      saveSchedules();
      
      // Выполняем через Claude Code (пропускаем если пользователь уже работает)
      if (config.adminId) {
        const session = getSession(config.adminId);
        if (session.busy) {
          console.log(`[scheduler] skipping "${schedule.name}" — session busy`);
          schedule.lastRunAt = null; // Даём повторить в следующую минуту
          saveSchedules();
          continue;
        }
        session.send(schedule.prompt, {
          onDone: async (response) => {
            try {
              // Прогоняем через hooks (маскировка секретов, md→html)
              const safe = processResponse(response);
              const { cleanText, markers } = parseMediaMarkers(safe);

              // Отправляем медиа-маркеры
              const chatCtx = { replyWithPhoto: (s, o) => bot.api.sendPhoto(config.adminId, s, o),
                replyWithDocument: (s, o) => bot.api.sendDocument(config.adminId, s, o),
                replyWithVideo: (s, o) => bot.api.sendVideo(config.adminId, s, o),
                replyWithAudio: (s, o) => bot.api.sendAudio(config.adminId, s, o),
                replyWithVoice: (s, o) => bot.api.sendVoice(config.adminId, s, o),
                replyWithSticker: (s) => bot.api.sendSticker(config.adminId, s),
                replyWithAnimation: (s, o) => bot.api.sendAnimation(config.adminId, s, o),
              };
              for (const marker of markers) {
                await sendMedia(chatCtx, marker);
              }

              if (cleanText) {
                await bot.api.sendMessage(config.adminId, cleanText.slice(0, config.messageMaxLen), {
                  parse_mode: 'HTML',
                });
              }
            } catch (err) {
              console.error(`[scheduler] send error: ${err.message}`);
              try {
                const plain = response.replace(/<[^>]+>/g, '');
                await bot.api.sendMessage(config.adminId, plain.slice(0, config.messageMaxLen));
              } catch {}
            }
          },
          onError: async (err) => {
            try {
              await bot.api.sendMessage(config.adminId, `[scheduler] Ошибка: ${err.message}`);
            } catch {}
          },
        });
      }
      
      // Для одноразовых — отключаем после выполнения
      if (schedule.type === 'once') {
        schedule.enabled = false;
        saveSchedules();
      }
    }
  }, 60_000);
  
  console.log(`[scheduler] started, ${schedules.length} schedule(s) loaded`);

  // ── Мониторинг источников ──
  // Проверяем каждые 30 мин. Дайджест отправляем в digestHour (из monitor.json)
  let lastMonitorCheck = 0;
  let lastDigestDate = '';

  setInterval(async () => {
    const monCfg = loadMonitorConfig();
    if (!monCfg.enabled || !monCfg.sources?.length || !config.adminId) return;

    const now = Date.now();
    // Проверка раз в 30 минут
    if (now - lastMonitorCheck < 30 * 60_000) return;
    lastMonitorCheck = now;

    try {
      const items = await checkAllSources();
      if (!items.length) return;

      // Отправляем дайджест если настал digestHour ИЛИ накопилось 10+ новых
      const { hour } = getNowInTz();
      const today = new Date().toISOString().slice(0, 10);
      const isDigestTime = hour === (monCfg.digestHour ?? 9) && lastDigestDate !== today;

      if (isDigestTime || items.length >= 10) {
        const digest = formatDigest(items);
        if (digest) {
          await bot.api.sendMessage(config.adminId, digest.slice(0, config.messageMaxLen), {
            parse_mode: 'HTML',
          }).catch(err => console.error(`[scheduler] monitor send: ${err.message}`));
          if (isDigestTime) lastDigestDate = today;
        }
      }
    } catch (err) {
      console.error(`[scheduler] monitor error: ${err.message}`);
    }
  }, 60_000); // проверяем каждую минуту, но сам fetch — раз в 30 мин (через lastMonitorCheck)
}
