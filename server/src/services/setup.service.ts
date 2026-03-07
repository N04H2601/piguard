import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { healthChecksRepo, settingsRepo } from '../database/repositories.js';
import { hashPassword } from './auth.service.js';

export interface SetupHealthCheckInput {
  name: string;
  type: 'http' | 'tcp' | 'dns' | 'icmp';
  target: string;
  interval_s?: number;
  timeout_ms?: number;
  expected_status?: number;
}

export interface SetupInput {
  username: string;
  password: string;
  language: 'fr' | 'en';
  instanceName?: string;
  healthChecks: SetupHealthCheckInput[];
  notifications?: {
    ntfyUrl?: string;
    ntfyTopic?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    webhookUrl?: string;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    smtpFrom?: string;
    smtpTo?: string;
  };
}

const SETUP_KEY = 'app.setup_complete';
const LANGUAGE_KEY = 'app.language';
const INSTANCE_NAME_KEY = 'app.instance_name';
const ADMIN_USERNAME_KEY = 'auth.admin_username';
const ADMIN_PASSWORD_HASH_KEY = 'auth.admin_password_hash';
const ADMIN_SOURCE_KEY = 'auth.source';
const SETUP_COMPLETED_AT_KEY = 'app.setup_completed_at';

const notificationKeys = {
  ntfyUrl: 'notify.ntfy_url',
  ntfyTopic: 'notify.ntfy_topic',
  telegramBotToken: 'notify.telegram_bot_token',
  telegramChatId: 'notify.telegram_chat_id',
  webhookUrl: 'notify.webhook_url',
  smtpHost: 'notify.smtp_host',
  smtpPort: 'notify.smtp_port',
  smtpUser: 'notify.smtp_user',
  smtpPass: 'notify.smtp_pass',
  smtpFrom: 'notify.smtp_from',
  smtpTo: 'notify.smtp_to',
} as const;

export function isSetupComplete() {
  return settingsRepo.get(SETUP_KEY) === '1';
}

export function getAppLanguage() {
  return settingsRepo.get(LANGUAGE_KEY, 'fr') === 'en' ? 'en' : 'fr';
}

export function getInstanceName() {
  return settingsRepo.get(INSTANCE_NAME_KEY, 'PiGuard');
}

export function setInstanceName(name: string) {
  settingsRepo.set(INSTANCE_NAME_KEY, name.trim() || 'PiGuard');
}

export function setAppLanguage(language: string) {
  settingsRepo.set(LANGUAGE_KEY, language === 'en' ? 'en' : 'fr');
}

export async function changeAdminPassword(newPassword: string) {
  const newHash = await hashPassword(newPassword);
  settingsRepo.set(ADMIN_PASSWORD_HASH_KEY, newHash);
}

export function updateNotificationSettings(notifications: Record<string, string>) {
  for (const [field, key] of Object.entries(notificationKeys) as Array<[keyof typeof notificationKeys, string]>) {
    if (notifications[field] !== undefined) {
      settingsRepo.set(key, (notifications[field] ?? '').trim());
    }
  }
}

export function getAdminSettings() {
  if (!isSetupComplete()) return null;

  const username = settingsRepo.get(ADMIN_USERNAME_KEY);
  const passwordHash = settingsRepo.get(ADMIN_PASSWORD_HASH_KEY);
  if (!username || !passwordHash) return null;

  return {
    username,
    passwordHash,
    source: settingsRepo.get(ADMIN_SOURCE_KEY, 'settings') ?? 'settings',
  };
}

export function getSetupStatus() {
  const admin = getAdminSettings();
  return {
    complete: isSetupComplete(),
    language: getAppLanguage(),
    hasAdmin: Boolean(admin?.username),
    source: admin?.source ?? null,
  };
}

export async function bootstrapLegacySetupFromEnv() {
  if (isSetupComplete()) return;

  const config = getConfig();
  const log = getLogger();

  if (!shouldPromoteEnvCredentials(config.ADMIN_USER, config.ADMIN_PASSWORD)) {
    return;
  }

  const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
  settingsRepo.set(ADMIN_USERNAME_KEY, config.ADMIN_USER);
  settingsRepo.set(ADMIN_PASSWORD_HASH_KEY, passwordHash);
  settingsRepo.set(ADMIN_SOURCE_KEY, 'env-bootstrap');
  settingsRepo.set(LANGUAGE_KEY, 'fr');
  settingsRepo.set(SETUP_KEY, '1');
  settingsRepo.set(SETUP_COMPLETED_AT_KEY, new Date().toISOString());

  const notificationPairs: Array<[string, string | undefined]> = [
    [notificationKeys.ntfyUrl, config.NTFY_URL],
    [notificationKeys.ntfyTopic, config.NTFY_TOPIC],
    [notificationKeys.telegramBotToken, config.TELEGRAM_BOT_TOKEN],
    [notificationKeys.telegramChatId, config.TELEGRAM_CHAT_ID],
    [notificationKeys.webhookUrl, config.WEBHOOK_URL],
    [notificationKeys.smtpHost, config.SMTP_HOST],
    [notificationKeys.smtpPort, config.SMTP_PORT ? String(config.SMTP_PORT) : undefined],
    [notificationKeys.smtpUser, config.SMTP_USER],
    [notificationKeys.smtpPass, config.SMTP_PASS],
    [notificationKeys.smtpFrom, config.SMTP_FROM],
    [notificationKeys.smtpTo, config.SMTP_TO],
  ];

  for (const [key, value] of notificationPairs) {
    if (value) settingsRepo.set(key, value);
  }

  log.info('Promoted legacy env admin credentials into first-run settings');
}

export async function completeInitialSetup(input: SetupInput) {
  const passwordHash = await hashPassword(input.password);

  settingsRepo.set(ADMIN_USERNAME_KEY, input.username.trim());
  settingsRepo.set(ADMIN_PASSWORD_HASH_KEY, passwordHash);
  settingsRepo.set(ADMIN_SOURCE_KEY, 'wizard');
  settingsRepo.set(LANGUAGE_KEY, input.language === 'en' ? 'en' : 'fr');
  settingsRepo.set(INSTANCE_NAME_KEY, (input.instanceName ?? 'PiGuard').trim() || 'PiGuard');
  settingsRepo.set(SETUP_KEY, '1');
  settingsRepo.set(SETUP_COMPLETED_AT_KEY, new Date().toISOString());

  const notifications = input.notifications ?? {};
  for (const [field, key] of Object.entries(notificationKeys) as Array<[keyof typeof notificationKeys, string]>) {
    settingsRepo.set(key, (notifications[field] ?? '').trim());
  }

  healthChecksRepo.replaceAll(
    input.healthChecks.map((check) => ({
      name: check.name.trim(),
      type: check.type,
      target: check.target.trim(),
      interval_s: check.interval_s ?? 60,
      timeout_ms: check.timeout_ms ?? 10000,
      expected_status: check.expected_status ?? 200,
      enabled: 1,
    }))
  );
}

export function getNotificationSettings() {
  const config = getConfig();
  return {
    ntfyUrl: settingsRepo.get(notificationKeys.ntfyUrl, config.NTFY_URL ?? ''),
    ntfyTopic: settingsRepo.get(notificationKeys.ntfyTopic, config.NTFY_TOPIC ?? ''),
    telegramBotToken: settingsRepo.get(notificationKeys.telegramBotToken, config.TELEGRAM_BOT_TOKEN ?? ''),
    telegramChatId: settingsRepo.get(notificationKeys.telegramChatId, config.TELEGRAM_CHAT_ID ?? ''),
    webhookUrl: settingsRepo.get(notificationKeys.webhookUrl, config.WEBHOOK_URL ?? ''),
    smtpHost: settingsRepo.get(notificationKeys.smtpHost, config.SMTP_HOST ?? ''),
    smtpPort: settingsRepo.get(notificationKeys.smtpPort, String(config.SMTP_PORT ?? '')),
    smtpUser: settingsRepo.get(notificationKeys.smtpUser, config.SMTP_USER ?? ''),
    smtpPass: settingsRepo.get(notificationKeys.smtpPass, config.SMTP_PASS ?? ''),
    smtpFrom: settingsRepo.get(notificationKeys.smtpFrom, config.SMTP_FROM ?? ''),
    smtpTo: settingsRepo.get(notificationKeys.smtpTo, config.SMTP_TO ?? ''),
  };
}

function shouldPromoteEnvCredentials(username: string, password: string) {
  const user = username.trim();
  const pass = password.trim();
  if (!user || !pass) return false;
  if (user === 'admin' && pass === 'changeme') return false;
  return true;
}
