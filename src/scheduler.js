// Система таймеров/расписаний
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from './config.js';
import { getSession } from './claude-session.js';

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
      
      // Выполняем через Claude Code
      if (config.adminId) {
        const session = getSession(config.adminId);
        session.send(schedule.prompt, {
          onDone: async (response) => {
            try {
              await bot.api.sendMessage(config.adminId, response.slice(0, config.messageMaxLen), {
                parse_mode: 'HTML',
              });
            } catch (err) {
              console.error(`[scheduler] send error: ${err.message}`);
              // Повтор без parse_mode если HTML невалидный
              try {
                await bot.api.sendMessage(config.adminId, response.slice(0, config.messageMaxLen));
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
