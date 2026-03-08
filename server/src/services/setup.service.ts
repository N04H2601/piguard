import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { settingsRepo } from '../database/repositories.js';
import { getDatabase } from '../database/init.js';
import { hashPassword } from './auth.service.js';
import { inferEmailProvider, type EmailProvider } from '../lib/notification-settings.js';

export interface SetupInput {
  username: string;
  password: string;
  language: 'fr' | 'en';
  instanceName?: string;
  notifications?: {
    telegramBotToken?: string;
    telegramChatId?: string;
    smtpProvider?: EmailProvider;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    smtpFrom?: string;
    smtpTo?: string;
    smtpTls?: boolean;
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
  telegramBotToken: 'notify.telegram_bot_token',
  telegramChatId: 'notify.telegram_chat_id',
  smtpProvider: 'notify.smtp_provider',
  smtpHost: 'notify.smtp_host',
  smtpPort: 'notify.smtp_port',
  smtpUser: 'notify.smtp_user',
  smtpPass: 'notify.smtp_pass',
  smtpFrom: 'notify.smtp_from',
  smtpTo: 'notify.smtp_to',
  smtpTls: 'notify.smtp_tls',
} as const;

const aiKeys = {
  openaiApiKey: 'ai.openai_api_key',
  openaiModel: 'ai.openai_model',
} as const;

export function isSetupComplete() {
  return settingsRepo.get(SETUP_KEY) === '1';
}

export function getAppLanguage() {
  return settingsRepo.get(LANGUAGE_KEY, 'fr') === 'en' ? 'en' : 'fr';
}

export function getInstanceName() {
  return settingsRepo.get(INSTANCE_NAME_KEY, 'PiGuard') ?? 'PiGuard';
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

const MASKED_VALUE = '••••••';

function getNotificationValue(key: string, fallback: string, treatBlankAsMissing = false) {
  const stored = settingsRepo.get(key);
  if (stored === undefined) return fallback;
  if (treatBlankAsMissing && stored.trim() === '') return fallback;
  return stored;
}

export function updateNotificationSettings(notifications: Record<string, string | boolean>) {
  for (const [field, key] of Object.entries(notificationKeys) as Array<[keyof typeof notificationKeys, string]>) {
    if (notifications[field] !== undefined && notifications[field] !== MASKED_VALUE) {
      const value = notifications[field];
      settingsRepo.set(key, typeof value === 'string' ? value.trim() : String(value ?? ''));
    }
  }
}

export function updateAiSettings(settings: { openaiApiKey?: string; openaiModel?: string }) {
  if (settings.openaiApiKey !== undefined && settings.openaiApiKey !== MASKED_VALUE) {
    settingsRepo.set(aiKeys.openaiApiKey, settings.openaiApiKey.trim());
  }

  if (settings.openaiModel !== undefined) {
    settingsRepo.set(aiKeys.openaiModel, settings.openaiModel.trim() || getConfig().OPENAI_MODEL || 'gpt-5.4');
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
    [notificationKeys.telegramBotToken, config.TELEGRAM_BOT_TOKEN],
    [notificationKeys.telegramChatId, config.TELEGRAM_CHAT_ID],
    [notificationKeys.smtpProvider, config.SMTP_HOST ? inferEmailProvider(config.SMTP_HOST) : undefined],
    [notificationKeys.smtpHost, config.SMTP_HOST],
    [notificationKeys.smtpPort, config.SMTP_PORT ? String(config.SMTP_PORT) : undefined],
    [notificationKeys.smtpUser, config.SMTP_USER],
    [notificationKeys.smtpPass, config.SMTP_PASS],
    [notificationKeys.smtpFrom, config.SMTP_FROM],
    [notificationKeys.smtpTo, config.SMTP_TO],
    [notificationKeys.smtpTls, config.SMTP_TLS],
  ];

  for (const [key, value] of notificationPairs) {
    if (value) settingsRepo.set(key, value);
  }

  log.info('Promoted legacy env admin credentials into first-run settings');
}

export async function completeInitialSetup(input: SetupInput) {
  const passwordHash = await hashPassword(input.password);
  const db = getDatabase();
  const upsertSetting = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  );
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETUP_KEY) as { value?: string } | undefined;
    if (existing?.value === '1') {
      return false;
    }

    const write = (key: string, value: string) => {
      upsertSetting.run(key, value, value);
    };

    write(ADMIN_USERNAME_KEY, input.username.trim());
    write(ADMIN_PASSWORD_HASH_KEY, passwordHash);
    write(ADMIN_SOURCE_KEY, 'wizard');
    write(LANGUAGE_KEY, input.language === 'en' ? 'en' : 'fr');
    write(INSTANCE_NAME_KEY, (input.instanceName ?? 'PiGuard').trim() || 'PiGuard');
    write(SETUP_KEY, '1');
    write(SETUP_COMPLETED_AT_KEY, new Date().toISOString());

    const notifications = input.notifications ?? {};
    for (const [field, key] of Object.entries(notificationKeys) as Array<[keyof typeof notificationKeys, string]>) {
      if (notifications[field] !== undefined) {
        const value = notifications[field];
        write(key, typeof value === 'string' ? value.trim() : String(value ?? ''));
      }
    }

    return true;
  });

  return tx();
}

export function getNotificationSettings() {
  const config = getConfig();
  const smtpHost = getNotificationValue(notificationKeys.smtpHost, config.SMTP_HOST ?? '', true);
  const smtpProvider = (getNotificationValue(
    notificationKeys.smtpProvider,
    smtpHost ? inferEmailProvider(smtpHost) : 'gmail',
    true
  ) as EmailProvider) ?? 'gmail';
  const smtpTlsRaw = getNotificationValue(notificationKeys.smtpTls, config.SMTP_TLS ?? '', true);
  return {
    telegramBotToken: getNotificationValue(notificationKeys.telegramBotToken, config.TELEGRAM_BOT_TOKEN ?? ''),
    telegramChatId: getNotificationValue(notificationKeys.telegramChatId, config.TELEGRAM_CHAT_ID ?? ''),
    smtpProvider,
    smtpHost,
    smtpPort: getNotificationValue(notificationKeys.smtpPort, String(config.SMTP_PORT ?? ''), true),
    smtpUser: getNotificationValue(notificationKeys.smtpUser, config.SMTP_USER ?? '', true),
    smtpPass: getNotificationValue(notificationKeys.smtpPass, config.SMTP_PASS ?? '', true),
    smtpFrom: getNotificationValue(notificationKeys.smtpFrom, config.SMTP_FROM ?? '', true),
    smtpTo: getNotificationValue(notificationKeys.smtpTo, config.SMTP_TO ?? ''),
    smtpTls: smtpTlsRaw ? smtpTlsRaw === 'true' : (smtpProvider === 'custom' ? getNotificationValue(notificationKeys.smtpPort, String(config.SMTP_PORT ?? ''), true) === '465' : true),
  };
}

export function getAiSettings() {
  const config = getConfig();
  const openaiApiKey = getNotificationValue(aiKeys.openaiApiKey, config.OPENAI_API_KEY ?? '', true);
  const openaiModel = getNotificationValue(aiKeys.openaiModel, config.OPENAI_MODEL ?? 'gpt-5.4', true) || config.OPENAI_MODEL || 'gpt-5.4';

  return {
    openaiApiKey,
    openaiModel,
  };
}

function shouldPromoteEnvCredentials(username: string, password: string) {
  const user = username.trim();
  const pass = password.trim();
  if (!user || !pass) return false;
  if (user === 'admin' && pass === 'changeme') return false;
  return true;
}
