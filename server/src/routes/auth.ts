import { Router, Request, Response } from 'express';
import { verifyPassword, createToken, generateApiKey, getAdminUsername, isAuthConfigured, refreshAuthState, revokeToken } from '../services/auth.service.js';
import { loginRepo, apiKeysRepo } from '../database/repositories.js';
import { loginLimiter } from '../middleware/rate-limit.js';
import { getLogger } from '../logger.js';
import { ensureCsrfToken } from '../middleware/security.js';
import { completeInitialSetup, getSetupStatus, isSetupComplete, getInstanceName } from '../services/setup.service.js';
import { parseIdParam } from '../lib/params.js';
import { isCookieSecure } from '../config.js';
import { getPasswordPolicyError } from '../lib/password-policy.js';
import { normalizeNotificationSettingsInput, validateNotificationSettings } from '../lib/notification-settings.js';
import { sendConfiguredNotification, sendTestEmail } from '../services/notification.service.js';

const router = Router();

router.get('/csrf', (req: Request, res: Response) => {
  const token = ensureCsrfToken(req, res);
  res.json({ success: true, data: { token } });
});

router.get('/setup-status', (_req: Request, res: Response) => {
  res.json({ success: true, data: getSetupStatus() });
});

router.post('/setup', async (req: Request, res: Response) => {
  if (isSetupComplete()) {
    res.status(409).json({ success: false, error: 'Initial setup already completed' });
    return;
  }

  const { username, password, language, instanceName, notifications } = req.body ?? {};

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    res.status(400).json({ success: false, error: 'username must be at least 3 characters' });
    return;
  }

  if (!password || typeof password !== 'string') {
    res.status(400).json({ success: false, error: 'password is required' });
    return;
  }

  const passwordError = getPasswordPolicyError(password);
  if (passwordError) {
    res.status(400).json({ success: false, error: passwordError });
    return;
  }

  if (language !== 'fr' && language !== 'en') {
    res.status(400).json({ success: false, error: 'language must be fr or en' });
    return;
  }

  const normalizedNotifications = normalizeNotificationSettingsInput(notifications ?? {});
  const notificationError = validateNotificationSettings(normalizedNotifications);
  if (notificationError) {
    res.status(400).json({ success: false, error: notificationError });
    return;
  }

  const setupApplied = await completeInitialSetup({
    username,
    password,
    language,
    instanceName: typeof instanceName === 'string' ? instanceName : undefined,
    notifications: {
      telegramBotToken: normalizedNotifications.telegramBotToken,
      telegramChatId: normalizedNotifications.telegramChatId,
      smtpProvider: normalizedNotifications.smtpProvider,
      smtpHost: normalizedNotifications.smtpHost,
      smtpPort: normalizedNotifications.smtpPort,
      smtpUser: normalizedNotifications.smtpUser,
      smtpPass: normalizedNotifications.smtpPass,
      smtpFrom: normalizedNotifications.smtpFrom,
      smtpTo: normalizedNotifications.smtpTo,
      smtpTls: normalizedNotifications.smtpTls,
    },
  });
  if (!setupApplied) {
    res.status(409).json({ success: false, error: 'Initial setup already completed' });
    return;
  }

  await refreshAuthState();
  const token = await createToken(username.trim());
  loginRepo.record(req.ip ?? 'unknown', (req.headers['user-agent'] as string | undefined) ?? null, true, username.trim());
  void sendDashboardAuthNotification('setup_completed', req.ip ?? 'unknown', username.trim(), true, uaToString(req.headers['user-agent']));
  res.cookie('piguard_session', token, {
    httpOnly: true,
    secure: isCookieSecure(req),
    sameSite: 'strict',
    maxAge: 86400000,
    path: '/',
  });

  res.status(201).json({ success: true, data: { username: username.trim(), setupComplete: true } });
});

router.post('/setup/notifications/test', async (req: Request, res: Response) => {
  if (isSetupComplete()) {
    res.status(409).json({ success: false, error: 'Initial setup already completed' });
    return;
  }

  const settings = normalizeNotificationSettingsInput(req.body?.notifications ?? req.body ?? {});
  const validationError = validateNotificationSettings(settings);
  if (validationError) {
    res.status(400).json({ success: false, error: validationError });
    return;
  }

  try {
    await sendTestEmail(settings, getInstanceName());
    res.json({ success: true, data: { message: `Test email sent to ${settings.smtpTo}` } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Failed to send test email' });
  }
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const log = getLogger();
  const { username, password } = req.body ?? {};
  const ip = req.ip ?? 'unknown';
  const ua = req.headers['user-agent'] ?? null;

  if (!isAuthConfigured()) {
    res.status(403).json({ success: false, error: 'Initial setup required' });
    return;
  }

  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Missing credentials' });
    return;
  }

  if (username !== getAdminUsername() || !(await verifyPassword(password))) {
    loginRepo.record(ip, ua, false, username);
    log.warn({ ip, username }, 'Failed login attempt');
    void sendDashboardAuthNotification('dashboard_login_failed', ip, username, false, uaToString(ua));
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }

  loginRepo.record(ip, ua, true, username);
  const token = await createToken(username);
  void sendDashboardAuthNotification('dashboard_login_success', ip, username, true, uaToString(ua));

  res.cookie('piguard_session', token, {
    httpOnly: true,
    secure: isCookieSecure(req),
    sameSite: 'strict',
    maxAge: 86400000,
    path: '/',
  });

  log.info({ ip, username }, 'Successful login');
  res.json({ success: true, data: { username } });
});

router.post('/logout', async (req: Request, res: Response) => {
  const token = req.cookies?.piguard_session;
  if (typeof token === 'string' && token.length > 0) {
    await revokeToken(token);
  }
  res.clearCookie('piguard_session', { path: '/' });
  res.json({ success: true });
});

router.get('/me', (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }
  res.json({ success: true, data: { username: user.sub, instanceName: getInstanceName() } });
});

router.post('/api-keys', (req: Request, res: Response) => {
  const { name } = req.body ?? {};
  if (!name) {
    res.status(400).json({ success: false, error: 'Name is required' });
    return;
  }
  const { key, hash } = generateApiKey();
  apiKeysRepo.create(name, hash);
  res.json({ success: true, data: { key, name } });
});

router.get('/api-keys', (_req: Request, res: Response) => {
  res.json({ success: true, data: apiKeysRepo.getAll() });
});

router.delete('/api-keys/:id', (req: Request, res: Response) => {
  const id = parseIdParam(req, res);
  if (id === null) return;
  apiKeysRepo.delete(id);
  res.json({ success: true });
});

router.get('/login-history', (_req: Request, res: Response) => {
  res.json({ success: true, data: loginRepo.getRecent() });
});

export default router;

function uaToString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getAuthNotificationMessage(eventType: 'setup_completed' | 'dashboard_login_success' | 'dashboard_login_failed', ip: string, username: string, userAgent: string | null) {
  const agent = userAgent ? ` (${userAgent})` : '';
  switch (eventType) {
    case 'setup_completed':
      return {
        severity: 'info',
        message: `First-run setup completed for ${username} from ${ip}${agent}.`,
        dedupeKey: `auth:${eventType}:${username}:${ip}`,
      };
    case 'dashboard_login_failed':
      return {
        severity: 'warning',
        message: `Failed dashboard login for ${username} from ${ip}${agent}.`,
        dedupeKey: `auth:${eventType}:${username}:${ip}`,
      };
    default:
      return {
        severity: 'info',
        message: `Successful dashboard login for ${username} from ${ip}${agent}.`,
        dedupeKey: `auth:${eventType}:${username}:${ip}`,
      };
  }
}

async function sendDashboardAuthNotification(
  eventType: 'setup_completed' | 'dashboard_login_success' | 'dashboard_login_failed',
  ip: string,
  username: string,
  success: boolean,
  userAgent: string | null,
) {
  const detail = getAuthNotificationMessage(eventType, ip, username, userAgent);
  await sendConfiguredNotification({
    ruleName: 'Dashboard Access',
    severity: detail.severity,
    value: success ? 1 : 0,
    message: detail.message,
    timestamp: new Date().toISOString(),
  }, {
    dedupeKey: detail.dedupeKey,
    dedupeMs: eventType === 'dashboard_login_failed' ? 60_000 : 5_000,
  });
}
