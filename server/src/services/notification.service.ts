import { getLogger } from '../logger.js';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { createTransport } from 'nodemailer';
import { getAppLanguage, getInstanceName, getNotificationSettings } from './setup.service.js';
import type { NormalizedNotificationSettings } from '../lib/notification-settings.js';

interface AlertPayload {
  ruleName: string;
  severity: string;
  value: number;
  message: string;
  timestamp: string;
}

interface SendNotificationOptions {
  throwOnError?: boolean;
}

interface SendConfiguredNotificationOptions extends SendNotificationOptions {
  dedupeKey?: string;
  dedupeMs?: number;
}

const recentNotificationKeys = new Map<string, number>();
const DEFAULT_DEDUPE_MS = 60_000;

export async function sendNotification(channels: string[], payload: AlertPayload, options: SendNotificationOptions = {}): Promise<void> {
  const log = getLogger();
  const failures: string[] = [];

  for (const channel of channels) {
    try {
      switch (channel) {
        case 'telegram':
          await sendTelegram(payload);
          break;
        case 'email':
          await sendEmail(payload, getNotificationSettings());
          break;
        default:
          log.warn({ channel }, 'Unknown notification channel');
      }
    } catch (err) {
      log.error({ err, channel }, 'Failed to send notification');
      failures.push(err instanceof Error ? `${channel}: ${err.message}` : `${channel}: Unknown notification error`);
    }
  }

  if (failures.length > 0 && options.throwOnError) {
    throw new Error(failures.join('; '));
  }
}

export async function sendTestEmail(settings: Pick<NormalizedNotificationSettings, 'smtpHost' | 'smtpPort' | 'smtpUser' | 'smtpPass' | 'smtpFrom' | 'smtpTo' | 'smtpTls'>, instanceName: string): Promise<void> {
  await sendEmail({
    ruleName: 'Test Notification',
    severity: 'info',
    value: 0,
    message: `This is a test notification from PiGuard (${instanceName}).`,
    timestamp: new Date().toISOString(),
  }, settings);
}

export function getConfiguredNotificationChannels(): string[] {
  const settings = getNotificationSettings();
  const channels: string[] = [];

  if (settings.telegramBotToken && settings.telegramChatId) {
    channels.push('telegram');
  }

  if (settings.smtpHost && settings.smtpFrom && settings.smtpTo) {
    channels.push('email');
  }

  return channels;
}

export async function sendConfiguredNotification(
  payload: AlertPayload,
  options: SendConfiguredNotificationOptions = {},
): Promise<void> {
  const channels = getConfiguredNotificationChannels();
  if (channels.length === 0) {
    return;
  }

  if (options.dedupeKey) {
    pruneNotificationDedupe();
    const now = Date.now();
    const lastSentAt = recentNotificationKeys.get(options.dedupeKey) ?? 0;
    const dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;
    if (now - lastSentAt < dedupeMs) {
      return;
    }
    recentNotificationKeys.set(options.dedupeKey, now);
  }

  await sendNotification(channels, payload, options);
}

function httpPost(url: string, body: string, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const reqFn = isHttps ? httpsRequest : httpRequest;
    const req = reqFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 10000,
    }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegram(payload: AlertPayload): Promise<void> {
  const config = getNotificationSettings();
  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new Error('Telegram notifications are not configured');
  }

  const text = `*[${payload.severity.toUpperCase()}]* ${payload.ruleName}\n${payload.message}\nValue: ${payload.value}`;
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  await httpPost(url, JSON.stringify({
    chat_id: config.telegramChatId,
    text,
    parse_mode: 'Markdown',
  }));
}

async function sendEmail(
  payload: AlertPayload,
  config: Pick<NormalizedNotificationSettings, 'smtpHost' | 'smtpPort' | 'smtpUser' | 'smtpPass' | 'smtpFrom' | 'smtpTo' | 'smtpTls'>
): Promise<void> {
  if (!config.smtpHost || !config.smtpFrom || !config.smtpTo) {
    throw new Error('Email notifications are not configured');
  }
  const port = Number(config.smtpPort) || 587;
  const secure = port === 465;
  const useTls = config.smtpTls || secure;

  const transport = createTransport({
    host: config.smtpHost,
    port,
    secure,
    requireTLS: useTls && !secure,
    ignoreTLS: !useTls,
    ...(config.smtpUser && config.smtpPass ? {
      auth: { user: config.smtpUser, pass: config.smtpPass },
    } : {}),
  });

  const language = getAppLanguage();
  const instanceName = getInstanceName();
  const content = buildEmailContent(payload, instanceName, language);

  await transport.sendMail({
    from: config.smtpFrom,
    to: config.smtpTo,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

function pruneNotificationDedupe() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, timestamp] of recentNotificationKeys.entries()) {
    if (timestamp < cutoff) {
      recentNotificationKeys.delete(key);
    }
  }
}

function buildEmailContent(
  payload: AlertPayload,
  instanceName: string,
  language: 'fr' | 'en'
): { subject: string; text: string; html: string } {
  const isFrench = language === 'fr';
  const severityLabel = getSeverityLabel(payload.severity, language);
  const severityColor = getSeverityColor(payload.severity);
  const formattedTimestamp = formatEmailTimestamp(payload.timestamp, language);
  const isTest = payload.ruleName === 'Test Notification';

  const labels = isFrench
    ? {
        title: isTest ? 'Email de test PiGuard' : 'Alerte PiGuard',
        intro: isTest
          ? `Ceci est un email de test envoye depuis ${instanceName}.`
          : `Une nouvelle alerte a ete declenchee sur ${instanceName}.`,
        rule: 'Regle',
        severity: 'Niveau',
        value: 'Valeur',
        time: 'Heure',
        message: 'Message',
        footer: 'Cet email a ete genere automatiquement par PiGuard.',
        subjectPrefix: isTest ? 'Test email' : 'Alert',
      }
    : {
        title: isTest ? 'PiGuard Test Email' : 'PiGuard Alert',
        intro: isTest
          ? `This is a test email sent from ${instanceName}.`
          : `A new alert was triggered on ${instanceName}.`,
        rule: 'Rule',
        severity: 'Severity',
        value: 'Value',
        time: 'Time',
        message: 'Message',
        footer: 'This email was generated automatically by PiGuard.',
        subjectPrefix: isTest ? 'Test email' : 'Alert',
      };

  const subject = `[PiGuard] ${labels.subjectPrefix}: ${payload.ruleName}`;
  const text = [
    labels.title,
    labels.intro,
    '',
    `${labels.rule}: ${payload.ruleName}`,
    `${labels.severity}: ${severityLabel}`,
    `${labels.value}: ${payload.value}`,
    `${labels.time}: ${formattedTimestamp}`,
    `${labels.message}: ${payload.message}`,
    '',
    labels.footer,
  ].join('\n');

  const html = `
    <div style="margin:0;padding:24px;background:#0b1220;font-family:Arial,sans-serif;color:#e5eef7;">
      <div style="max-width:640px;margin:0 auto;background:#111827;border:1px solid #243041;border-radius:18px;overflow:hidden;">
        <div style="padding:24px 24px 18px;background:linear-gradient(135deg,#111827 0%,#172033 100%);border-bottom:1px solid #243041;">
          <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:${severityColor};color:#08111d;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
            ${escapeHtml(severityLabel)}
          </div>
          <h1 style="margin:14px 0 6px;font-size:28px;line-height:1.1;color:#f8fafc;">${escapeHtml(labels.title)}</h1>
          <p style="margin:0;color:#9fb0c3;font-size:15px;line-height:1.6;">${escapeHtml(labels.intro)}</p>
        </div>
        <div style="padding:24px;">
          <div style="padding:16px 18px;border-radius:14px;background:#0f172a;border:1px solid #243041;">
            <div style="font-size:13px;color:#8ea2b7;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${escapeHtml(labels.message)}</div>
            <div style="font-size:18px;line-height:1.5;color:#f8fafc;font-weight:600;">${escapeHtml(payload.message)}</div>
          </div>
          <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:18px;">
            ${renderEmailRow(labels.rule, payload.ruleName)}
            ${renderEmailRow(labels.severity, severityLabel)}
            ${renderEmailRow(labels.value, String(payload.value))}
            ${renderEmailRow(labels.time, formattedTimestamp)}
            ${renderEmailRow('Instance', instanceName)}
          </table>
        </div>
        <div style="padding:16px 24px;border-top:1px solid #243041;color:#7e93aa;font-size:12px;line-height:1.5;background:#0b1220;">
          ${escapeHtml(labels.footer)}
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

function renderEmailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #243041;color:#8ea2b7;font-size:13px;width:140px;vertical-align:top;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #243041;color:#f8fafc;font-size:14px;font-weight:600;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `;
}

function getSeverityLabel(severity: string, language: 'fr' | 'en'): string {
  const normalized = severity.toLowerCase();
  if (language === 'fr') {
    if (normalized === 'critical') return 'Critique';
    if (normalized === 'warning') return 'Avertissement';
    return 'Information';
  }

  if (normalized === 'critical') return 'Critical';
  if (normalized === 'warning') return 'Warning';
  return 'Info';
}

function getSeverityColor(severity: string): string {
  const normalized = severity.toLowerCase();
  if (normalized === 'critical') return '#fb7185';
  if (normalized === 'warning') return '#fbbf24';
  return '#38bdf8';
}

function formatEmailTimestamp(value: string, language: 'fr' | 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-US', {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
