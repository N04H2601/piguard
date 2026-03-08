export type EmailProvider = 'gmail' | 'outlook' | 'custom';

export const EMAIL_PROVIDER_PRESETS: Record<EmailProvider, { host: string; port: string; tls: boolean }> = {
  gmail: { host: 'smtp.gmail.com', port: '587', tls: true },
  outlook: { host: 'smtp.office365.com', port: '587', tls: true },
  custom: { host: '', port: '587', tls: true },
};

export function inferEmailProvider(host: string): EmailProvider {
  const normalized = host.trim().toLowerCase();
  if (normalized === EMAIL_PROVIDER_PRESETS.gmail.host) return 'gmail';
  if (normalized === EMAIL_PROVIDER_PRESETS.outlook.host) return 'outlook';
  return 'custom';
}

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
