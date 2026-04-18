// Система таймеров/расписаний
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from './config.js';
import { getSession } from './engine.js';
import { processResponse } from './hooks.js';
import { parseMediaMarkers, sendMedia } from './media.js';

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

function shouldRunNow(schedule) {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const weekday = now.getDay() || 7; // 1=Mon, 7=Sun
  
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
}
