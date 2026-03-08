import { healthChecksRepo } from '../database/repositories.js';
import { getLogger } from '../logger.js';
import { getConfig } from '../config.js';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { connect } from 'net';
import { resolve } from 'dns/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { TLSSocket, connect as tlsConnect } from 'tls';
import { sendConfiguredNotification } from './notification.service.js';
import { getAppLanguage } from './setup.service.js';

const execFileAsync = promisify(execFile);

let checkInterval: ReturnType<typeof setInterval> | null = null;
const nextRunAt = new Map<number, number>();
const inFlight = new Set<number>();

type DefaultCheck = {
  name: string;
  type: 'http' | 'tcp' | 'dns' | 'icmp';
  target: string;
  interval_s?: number;
  timeout_ms?: number;
  expected_status?: number;
};

export function startHealthChecks() {
  const log = getLogger();
  log.info('Starting health check scheduler');

  void runDueChecks();
  checkInterval = setInterval(() => {
    void runDueChecks();
  }, 1000);
}

export function stopHealthChecks() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  nextRunAt.clear();
  inFlight.clear();
}

async function runDueChecks() {
  const checks = healthChecksRepo.getEnabled() as any[];
  const now = Date.now();
  const enabledIds = new Set<number>(checks.map((check) => check.id));

  for (const id of nextRunAt.keys()) {
    if (!enabledIds.has(id)) nextRunAt.delete(id);
  }

  for (const check of checks) {
    const intervalMs = Math.max((check.interval_s ?? 60) * 1000, 5000);
    const next = nextRunAt.get(check.id) ?? 0;

    if (inFlight.has(check.id) || now < next) continue;

    nextRunAt.set(check.id, now + intervalMs);
    inFlight.add(check.id);
    void executeAndStore(check);
  }
}

async function executeAndStore(check: any) {
  try {
    const result = await executeCheck(check);
    healthChecksRepo.insertResult(check.id, result.status, result.latencyMs, result.error);
    await notifyHealthStatusTransition(check, result);
  } catch (err) {
    const result = { status: 'down', latencyMs: null, error: String(err) };
    healthChecksRepo.insertResult(check.id, result.status, result.latencyMs, result.error);
    await notifyHealthStatusTransition(check, result);
  } finally {
    inFlight.delete(check.id);
  }
}

async function notifyHealthStatusTransition(
  check: any,
  result: { status: string; latencyMs: number | null; error: string | null },
) {
  const previousStatus = typeof check.last_status === 'string' ? check.last_status : null;
  if (result.status === 'down' && previousStatus === 'down') {
    return;
  }
  if (result.status === 'up' && previousStatus !== 'down') {
    return;
  }

  const language = getAppLanguage();
  const latencyText = result.latencyMs !== null ? `${Math.round(result.latencyMs)} ms` : null;
  const target = check.target ?? check.name ?? 'unknown target';
  const isDown = result.status === 'down';
  const message = language === 'en'
    ? isDown
      ? `Health check "${check.name}" is down on ${target}${result.error ? ` (${result.error})` : ''}.`
      : `Health check "${check.name}" is back up on ${target}${latencyText ? ` (${latencyText})` : ''}.`
    : isDown
      ? `Le health check "${check.name}" est down sur ${target}${result.error ? ` (${result.error})` : ''}.`
      : `Le health check "${check.name}" est revenu up sur ${target}${latencyText ? ` (${latencyText})` : ''}.`;

  await sendConfiguredNotification({
    ruleName: `Health Check: ${check.name}`,
    severity: isDown ? 'warning' : 'info',
    value: result.latencyMs ?? 0,
    message,
    timestamp: new Date().toISOString(),
  }, {
    dedupeKey: `health-check:${check.id}:${result.status}`,
    dedupeMs: 5 * 60 * 1000,
  });
}

async function executeCheck(check: any): Promise<{ status: string; latencyMs: number | null; error: string | null }> {
  switch (check.type) {
    case 'http': {
      return httpCheck(check.target, check.timeout_ms, check.expected_status);
    }
    case 'tcp': {
      return tcpCheck(check.target, check.timeout_ms);
    }
    case 'dns': {
      return dnsCheck(check.target, check.timeout_ms);
    }
    case 'icmp': {
      return icmpCheck(check.target, check.timeout_ms);
    }
    default:
      return { status: 'down', latencyMs: null, error: `Unknown check type: ${check.type}` };
  }
}

function httpCheck(url: string, timeout: number, expectedStatus: number): Promise<{ status: string; latencyMs: number; error: string | null }> {
  return new Promise((resolveP) => {
    const start = performance.now();
    const isHttps = url.startsWith('https');
    const reqFn = isHttps ? httpsRequest : httpRequest;

    try {
      const req = reqFn(url, { timeout, rejectUnauthorized: false }, (res) => {
        const latencyMs = Math.round(performance.now() - start);
        const status = res.statusCode === expectedStatus ? 'up' : 'down';
        res.resume();
        resolveP({
          status,
          latencyMs,
          error: status === 'down' ? `Expected ${expectedStatus}, got ${res.statusCode}` : null,
        });
      });

      req.on('error', (err) => {
        resolveP({ status: 'down', latencyMs: Math.round(performance.now() - start), error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolveP({ status: 'down', latencyMs: timeout, error: 'Timeout' });
      });

      req.end();
    } catch (err: any) {
      resolveP({ status: 'down', latencyMs: 0, error: err.message });
    }
  });
}

function tcpCheck(target: string, timeout: number): Promise<{ status: string; latencyMs: number; error: string | null }> {
  return new Promise((resolveP) => {
    const start = performance.now();
    const [host, portStr] = target.split(':');
    const port = parseInt(portStr ?? '80');

    const socket = connect({ host, port, timeout }, () => {
      const latencyMs = Math.round(performance.now() - start);
      socket.destroy();
      resolveP({ status: 'up', latencyMs, error: null });
    });

    socket.on('error', (err) => {
      resolveP({ status: 'down', latencyMs: Math.round(performance.now() - start), error: err.message });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolveP({ status: 'down', latencyMs: timeout, error: 'Timeout' });
    });
  });
}

async function dnsCheck(domain: string, timeout: number): Promise<{ status: string; latencyMs: number; error: string | null }> {
  const start = performance.now();
  try {
    await Promise.race([
      resolve(domain),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout)),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - start), error: null };
  } catch (err: any) {
    return { status: 'down', latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

async function icmpCheck(host: string, timeout: number): Promise<{ status: string; latencyMs: number; error: string | null }> {
  const start = performance.now();
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    return { status: 'down', latencyMs: 0, error: 'Invalid host' };
  }
  try {
    const { stdout } = await execFileAsync('ping', ['-c', '1', '-W', String(Math.ceil(timeout / 1000)), host]);
    const match = stdout.match(/time=([\d.]+)/);
    const latencyMs = match ? parseFloat(match[1]!) : Math.round(performance.now() - start);
    return { status: 'up', latencyMs, error: null };
  } catch {
    return { status: 'down', latencyMs: Math.round(performance.now() - start), error: 'Ping failed' };
  }
}

export async function checkSslExpiry(hostname: string, port = 443): Promise<{ daysLeft: number; expiry: string; issuer: string } | null> {
  return new Promise((resolveP) => {
    if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) {
      resolveP(null);
      return;
    }
    try {
      const socket = tlsConnect({ host: hostname, port, servername: hostname, rejectUnauthorized: false }, () => {
        const cert = (socket as TLSSocket).getPeerCertificate();
        socket.destroy();
        if (cert?.valid_to) {
          const expiry = new Date(cert.valid_to);
          const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
          resolveP({
            daysLeft,
            expiry: expiry.toISOString(),
            issuer: typeof cert.issuer === 'object' ? (cert.issuer as any).O ?? '' : '',
          });
        } else {
          resolveP(null);
        }
      });
      socket.on('error', () => resolveP(null));
      socket.setTimeout(5000, () => { socket.destroy(); resolveP(null); });
    } catch {
      resolveP(null);
    }
  });
}

export function seedDefaultChecks() {
  const log = getLogger();
  const existing = healthChecksRepo.getAll() as any[];

  if (existing.length > 0) return;

  const defaults = getConfiguredDefaultChecks(log);
  if (defaults.length === 0) {
    log.info('No DEFAULT_HEALTH_CHECKS configured; skipping default health-check seeding');
    return;
  }

  for (const check of defaults) {
    healthChecksRepo.create(check);
  }
}

function getConfiguredDefaultChecks(log: ReturnType<typeof getLogger>): DefaultCheck[] {
  const config = getConfig();
  if (!config.DEFAULT_HEALTH_CHECKS?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(config.DEFAULT_HEALTH_CHECKS);
    if (!Array.isArray(parsed)) throw new Error('DEFAULT_HEALTH_CHECKS must be a JSON array');

    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        name: String(entry.name ?? '').trim(),
        type: (entry.type ?? 'http') as DefaultCheck['type'],
        target: String(entry.target ?? '').trim(),
        interval_s: Number(entry.interval_s ?? 60),
        timeout_ms: entry.timeout_ms !== undefined ? Number(entry.timeout_ms) : undefined,
        expected_status: entry.expected_status !== undefined ? Number(entry.expected_status) : undefined,
      }))
      .filter((entry) => entry.name && entry.target && ['http', 'tcp', 'dns', 'icmp'].includes(entry.type));
  } catch (err) {
    log.warn({ err }, 'Invalid DEFAULT_HEALTH_CHECKS JSON; skipping default health-check seeding');
    return [];
  }
}
