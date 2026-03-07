import { getLogger } from '../logger.js';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { getNotificationSettings } from './setup.service.js';

interface AlertPayload {
  ruleName: string;
  severity: string;
  value: number;
  message: string;
  timestamp: string;
}

export async function sendNotification(channels: string[], payload: AlertPayload): Promise<void> {
  const log = getLogger();

  for (const channel of channels) {
    try {
      switch (channel) {
        case 'ntfy':
          await sendNtfy(payload);
          break;
        case 'webhook':
          await sendWebhook(payload);
          break;
        case 'telegram':
          await sendTelegram(payload);
          break;
        default:
          log.warn({ channel }, 'Unknown notification channel');
      }
    } catch (err) {
      log.error({ err, channel }, 'Failed to send notification');
    }
  }
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

async function sendNtfy(payload: AlertPayload): Promise<void> {
  const config = getNotificationSettings();
  if (!config.ntfyUrl || !config.ntfyTopic) return;

  const url = `${config.ntfyUrl}/${config.ntfyTopic}`;
  const priorityMap: Record<string, string> = { critical: '5', warning: '4', info: '3' };
  await httpPost(url, payload.message, {
    Title: `[${payload.severity.toUpperCase()}] ${payload.ruleName}`,
    Priority: priorityMap[payload.severity] ?? '3',
    Tags: 'warning',
  });
}

async function sendWebhook(payload: AlertPayload): Promise<void> {
  const config = getNotificationSettings();
  if (!config.webhookUrl) return;
  await httpPost(config.webhookUrl, JSON.stringify(payload));
}

async function sendTelegram(payload: AlertPayload): Promise<void> {
  const config = getNotificationSettings();
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const text = `*[${payload.severity.toUpperCase()}]* ${payload.ruleName}\n${payload.message}\nValue: ${payload.value}`;
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  await httpPost(url, JSON.stringify({
    chat_id: config.telegramChatId,
    text,
    parse_mode: 'Markdown',
  }));
}
