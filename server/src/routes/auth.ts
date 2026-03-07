import { Router, Request, Response } from 'express';
import { verifyPassword, createToken, generateApiKey, getAdminUsername, isAuthConfigured, refreshAuthState } from '../services/auth.service.js';
import { loginRepo, apiKeysRepo } from '../database/repositories.js';
import { loginLimiter } from '../middleware/rate-limit.js';
import { getLogger } from '../logger.js';
import { ensureCsrfToken } from '../middleware/security.js';
import { completeInitialSetup, getSetupStatus, isSetupComplete, getInstanceName } from '../services/setup.service.js';
import { parseIdParam } from '../lib/params.js';
import { isCookieSecure } from '../config.js';

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

  const { username, password, language, instanceName, healthChecks, notifications } = req.body ?? {};

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    res.status(400).json({ success: false, error: 'username must be at least 3 characters' });
    return;
  }

  if (!password || typeof password !== 'string' || password.length < 10) {
    res.status(400).json({ success: false, error: 'password must be at least 10 characters' });
    return;
  }

  if (language !== 'fr' && language !== 'en') {
    res.status(400).json({ success: false, error: 'language must be fr or en' });
    return;
  }

  if (!Array.isArray(healthChecks) || healthChecks.length === 0) {
    res.status(400).json({ success: false, error: 'at least one health check is required' });
    return;
  }

  const sanitizedChecks = healthChecks
    .filter((check) => check && typeof check.name === 'string' && typeof check.type === 'string' && typeof check.target === 'string')
    .map((check) => ({
      name: check.name.trim().slice(0, 64),
      type: check.type,
      target: check.target.trim().slice(0, 512),
      interval_s: Math.max(15, Number(check.interval_s ?? 60)),
      timeout_ms: Math.max(1000, Number(check.timeout_ms ?? 10000)),
      expected_status: Number(check.expected_status ?? 200),
    }))
    .filter((check) => check.name && check.target && ['http', 'tcp', 'dns', 'icmp'].includes(check.type));

  if (sanitizedChecks.length === 0) {
    res.status(400).json({ success: false, error: 'no valid health checks provided' });
    return;
  }

  await completeInitialSetup({
    username,
    password,
    language,
    instanceName: typeof instanceName === 'string' ? instanceName : undefined,
    healthChecks: sanitizedChecks as any,
    notifications: {
      ntfyUrl: typeof notifications?.ntfyUrl === 'string' ? notifications.ntfyUrl : '',
      ntfyTopic: typeof notifications?.ntfyTopic === 'string' ? notifications.ntfyTopic : '',
      telegramBotToken: typeof notifications?.telegramBotToken === 'string' ? notifications.telegramBotToken : '',
      telegramChatId: typeof notifications?.telegramChatId === 'string' ? notifications.telegramChatId : '',
      webhookUrl: typeof notifications?.webhookUrl === 'string' ? notifications.webhookUrl : '',
      smtpHost: typeof notifications?.smtpHost === 'string' ? notifications.smtpHost : '',
      smtpPort: typeof notifications?.smtpPort === 'string' ? notifications.smtpPort : '',
      smtpUser: typeof notifications?.smtpUser === 'string' ? notifications.smtpUser : '',
      smtpPass: typeof notifications?.smtpPass === 'string' ? notifications.smtpPass : '',
      smtpFrom: typeof notifications?.smtpFrom === 'string' ? notifications.smtpFrom : '',
      smtpTo: typeof notifications?.smtpTo === 'string' ? notifications.smtpTo : '',
    },
  });

  await refreshAuthState();
  const token = await createToken(username.trim());
  res.cookie('piguard_session', token, {
    httpOnly: true,
    secure: isCookieSecure(req),
    sameSite: 'strict',
    maxAge: 86400000,
    path: '/',
  });

  res.status(201).json({ success: true, data: { username: username.trim(), setupComplete: true } });
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
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }

  loginRepo.record(ip, ua, true, username);
  const token = await createToken(username);

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

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('piguard_session');
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
