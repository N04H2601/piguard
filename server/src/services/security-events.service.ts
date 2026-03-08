import { parseAuthLog } from '../collectors/security.collector.js';
import { securityRepo } from '../database/repositories.js';
import { getLogger } from '../logger.js';
import { sendConfiguredNotification } from './notification.service.js';

type ParsedAuthEvent = {
  timestamp: string;
  type: string;
  ip: string | null;
  user: string | null;
  details: string;
};

let securityPollInterval: ReturnType<typeof setInterval> | null = null;
const knownSecurityEventKeys = new Map<string, number>();

export function startSecurityEventMonitor() {
  const log = getLogger();
  primeKnownSecurityEvents();
  void pollSecurityEvents();
  securityPollInterval = setInterval(() => {
    void pollSecurityEvents();
  }, 15_000);
  log.info('Starting security event monitor');
}

export function stopSecurityEventMonitor() {
  if (securityPollInterval) {
    clearInterval(securityPollInterval);
    securityPollInterval = null;
  }
  knownSecurityEventKeys.clear();
}

function primeKnownSecurityEvents() {
  for (const event of parseAuthLog()) {
    knownSecurityEventKeys.set(buildSecurityEventKey(event), Date.now());
  }
}

async function pollSecurityEvents() {
  pruneKnownSecurityEventKeys();
  const events = parseAuthLog();
  for (const event of events) {
    const key = buildSecurityEventKey(event);
    if (knownSecurityEventKeys.has(key)) {
      continue;
    }

    knownSecurityEventKeys.set(key, Date.now());
    securityRepo.insertEvent(
      event.type,
      event.ip,
      null,
      { user: event.user, details: event.details, rawTimestamp: event.timestamp },
      mapSecuritySeverity(event.type),
    );
    await notifySecurityEvent(event);
  }
}

function buildSecurityEventKey(event: ParsedAuthEvent) {
  return [event.timestamp, event.type, event.ip ?? '', event.user ?? '', event.details].join('|');
}

function pruneKnownSecurityEventKeys() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, timestamp] of knownSecurityEventKeys.entries()) {
    if (timestamp < cutoff) {
      knownSecurityEventKeys.delete(key);
    }
  }
}

function mapSecuritySeverity(type: string) {
  if (type === 'ssh_failed' || type === 'ssh_invalid_user') return 'warning';
  return 'info';
}

async function notifySecurityEvent(event: ParsedAuthEvent) {
  const notification = buildSecurityNotification(event);
  if (!notification) {
    return;
  }

  await sendConfiguredNotification({
    ruleName: notification.ruleName,
    severity: notification.severity,
    value: 1,
    message: notification.message,
    timestamp: new Date().toISOString(),
  }, {
    dedupeKey: `security:${buildSecurityEventKey(event)}`,
    dedupeMs: 30_000,
  });
}

function buildSecurityNotification(event: ParsedAuthEvent) {
  const source = event.ip ? ` from ${event.ip}` : '';
  const user = event.user ? ` for ${event.user}` : '';

  switch (event.type) {
    case 'ssh_success':
      return {
        ruleName: 'SSH Login',
        severity: 'info',
        message: `SSH login accepted${user}${source}.`,
      };
    case 'ssh_failed':
      return {
        ruleName: 'SSH Login',
        severity: 'warning',
        message: `SSH login failed${user}${source}.`,
      };
    case 'ssh_invalid_user':
      return {
        ruleName: 'SSH Login',
        severity: 'warning',
        message: `SSH login attempt for invalid user${user}${source}.`,
      };
    default:
      return null;
  }
}
