import { alertsRepo, metricsRepo } from '../database/repositories.js';
import { sendNotification } from './notification.service.js';
import { getLogger } from '../logger.js';

let alertInterval: ReturnType<typeof setInterval> | null = null;
const lastFired = new Map<number, number>();

export function startAlertEngine() {
  const log = getLogger();
  log.info('Starting alert engine');
  alertInterval = setInterval(evaluateRules, 15000);
}

export function stopAlertEngine() {
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
}

async function evaluateRules() {
  const log = getLogger();
  const rules = alertsRepo.getRules() as any[];

  for (const rule of rules) {
    try {
      const now = Date.now();
      const activeAlert = alertsRepo.getActiveForRule(rule.id) as any;
      const cooldown = (rule.cooldown_s ?? 300) * 1000;
      const last = lastFired.get(rule.id);

      const window = Math.max((rule.duration_s ?? 0) * 1000, 60000);
      const data = metricsRepo.query(rule.metric, now - window, now, 'local', 100);
      if (data.length === 0) continue;

      const values = data.map((d: any) => d.value);
      const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;

      const triggered = evaluateCondition(avg, rule.condition, rule.threshold);

      if (triggered) {
        if (activeAlert) {
          continue;
        }
        if (last && now - last < cooldown) continue;

        lastFired.set(rule.id, now);
        const message = `${rule.name}: ${rule.metric} = ${avg.toFixed(2)} (threshold: ${rule.condition} ${rule.threshold})`;
        alertsRepo.fireAlert(rule.id, avg, message);

        const channels = JSON.parse(rule.channels || '[]');
        if (channels.length > 0) {
          await sendNotification(channels, {
            ruleName: rule.name,
            severity: rule.severity,
            value: avg,
            message,
            timestamp: new Date().toISOString(),
          });
        }

        log.warn({ rule: rule.name, value: avg }, 'Alert fired');
      } else if (activeAlert) {
        alertsRepo.resolveActiveForRule(rule.id);
        log.info({ rule: rule.name, value: avg }, 'Alert resolved');
      }
    } catch (err) {
      log.error({ err, rule: rule.name }, 'Failed to evaluate alert rule');
    }
  }
}

function evaluateCondition(value: number, condition: string, threshold: number): boolean {
  switch (condition) {
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    default: return false;
  }
}

export function seedDefaultRules() {
  const existing = alertsRepo.getAllRules() as any[];
  if (existing.length > 0) return;

  const defaults = [
    { name: 'CPU High', metric: 'cpu.overall', condition: '>', threshold: 90, duration_s: 300, severity: 'warning' },
    { name: 'RAM Critical', metric: 'memory.usedPercent', condition: '>', threshold: 95, duration_s: 120, severity: 'critical' },
    { name: 'Temperature High', metric: 'temperature.temp', condition: '>', threshold: 80, duration_s: 60, severity: 'warning' },
    { name: 'Disk Full', metric: 'disk.usedPercent', condition: '>', threshold: 90, duration_s: 0, severity: 'critical' },
  ];

  for (const rule of defaults) {
    alertsRepo.createRule(rule);
  }
}
