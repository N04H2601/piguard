export type EmailProvider = 'gmail' | 'outlook' | 'custom';

export interface NotificationSettingsInput {
  telegramBotToken?: unknown;
  telegramChatId?: unknown;
  smtpProvider?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  smtpUser?: unknown;
  smtpPass?: unknown;
  smtpFrom?: unknown;
  smtpTo?: unknown;
  smtpTls?: unknown;
}

export interface NormalizedNotificationSettings {
  telegramBotToken: string;
  telegramChatId: string;
  smtpProvider: EmailProvider;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpTo: string;
  smtpTls: boolean;
}

export const EMAIL_PROVIDER_PRESETS: Record<EmailProvider, { host: string; port: string; tls: boolean }> = {
  gmail: { host: 'smtp.gmail.com', port: '587', tls: true },
  outlook: { host: 'smtp.office365.com', port: '587', tls: true },
  custom: { host: '', port: '587', tls: true },
};

export function normalizeNotificationSettingsInput(input: NotificationSettingsInput): NormalizedNotificationSettings {
  const telegramBotToken = asTrimmedString(input.telegramBotToken);
  const telegramChatId = asTrimmedString(input.telegramChatId);

  let smtpProvider = normalizeEmailProvider(input.smtpProvider);
  let smtpHost = asTrimmedString(input.smtpHost);
  let smtpPort = asTrimmedString(input.smtpPort);
  const smtpUser = asTrimmedString(input.smtpUser);
  const smtpPass = asTrimmedString(input.smtpPass);
  let smtpFrom = asTrimmedString(input.smtpFrom);
  const smtpTo = asTrimmedString(input.smtpTo);
  const hasExplicitEmailConfig = Boolean(smtpHost || smtpPort || smtpUser || smtpPass || smtpFrom || smtpTo);

  if (!hasExplicitEmailConfig) {
    return {
      telegramBotToken,
      telegramChatId,
      smtpProvider: smtpProvider ?? 'gmail',
      smtpHost: '',
      smtpPort: '',
      smtpUser,
      smtpPass,
      smtpFrom,
      smtpTo,
      smtpTls: parseBooleanLike(input.smtpTls, true),
    };
  }

  if (!smtpProvider && smtpHost) {
    smtpProvider = inferEmailProvider(smtpHost);
  }

  const provider = smtpProvider ?? 'gmail';
  const preset = EMAIL_PROVIDER_PRESETS[provider];

  if (provider !== 'custom') {
    smtpHost = smtpHost || preset.host;
    smtpPort = smtpPort || preset.port;
    if (!smtpFrom && smtpUser) {
      smtpFrom = smtpUser;
    }
  }

  if (!smtpPort && smtpHost) {
    smtpPort = preset.port;
  }

  const smtpTls = parseBooleanLike(input.smtpTls, provider === 'custom' ? smtpPort === '465' : preset.tls);

  return {
    telegramBotToken,
    telegramChatId,
    smtpProvider: provider,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    smtpFrom,
    smtpTo,
    smtpTls,
  };
}

export function validateNotificationSettings(settings: NormalizedNotificationSettings): string | null {
  if (Boolean(settings.telegramBotToken) !== Boolean(settings.telegramChatId)) {
    return 'telegramBotToken and telegramChatId must be provided together';
  }

  const hasAnyEmailValue = Boolean(
    settings.smtpTo
    || settings.smtpUser
    || settings.smtpPass
    || settings.smtpFrom
    || settings.smtpHost
    || settings.smtpPort
  );

  if (!hasAnyEmailValue) {
    return null;
  }

  if (!settings.smtpTo) {
    return 'smtpTo is required when email notifications are configured';
  }

  if (!isValidEmail(settings.smtpTo)) {
    return 'smtpTo must be a valid email address';
  }

  if (!settings.smtpHost) {
    return 'smtpHost is required when email notifications are configured';
  }

  if (!settings.smtpPort || !/^\d+$/.test(settings.smtpPort)) {
    return 'smtpPort must be a valid port number';
  }

  if (!settings.smtpFrom) {
    return 'smtpFrom is required when email notifications are configured';
  }

  if (!isValidEmail(settings.smtpFrom)) {
    return 'smtpFrom must be a valid email address';
  }

  if (settings.smtpProvider !== 'custom') {
    if (!settings.smtpUser || !isValidEmail(settings.smtpUser)) {
      return `${settings.smtpProvider} account address must be a valid email address`;
    }

    if (!settings.smtpPass) {
      return `${settings.smtpProvider} password is required`;
    }
  }

  return null;
}

export function inferEmailProvider(host: string): EmailProvider {
  const normalized = host.trim().toLowerCase();
  if (normalized === EMAIL_PROVIDER_PRESETS.gmail.host) return 'gmail';
  if (normalized === EMAIL_PROVIDER_PRESETS.outlook.host) return 'outlook';
  return 'custom';
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeEmailProvider(value: unknown): EmailProvider | null {
  if (value === 'gmail' || value === 'outlook' || value === 'custom') {
    return value;
  }
  return null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBooleanLike(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}
