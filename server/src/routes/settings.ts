import { Router, Request, Response } from 'express';
import { settingsRepo } from '../database/repositories.js';
import {
  getInstanceName, setInstanceName,
  getAppLanguage, setAppLanguage,
  changeAdminPassword, getNotificationSettings, updateNotificationSettings,
} from '../services/setup.service.js';
import { refreshAuthState, verifyPassword, getAdminUsername } from '../services/auth.service.js';
import { sendNotification } from '../services/notification.service.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: settingsRepo.getAll() });
});

router.get('/instance', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      instanceName: getInstanceName(),
      language: getAppLanguage(),
    },
  });
});

router.put('/instance', (req: Request, res: Response) => {
  const { instanceName, language } = req.body ?? {};
  if (instanceName !== undefined) setInstanceName(String(instanceName));
  if (language === 'fr' || language === 'en') setAppLanguage(language);
  res.json({ success: true });
});

router.put('/password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    return;
  }

  if (typeof newPassword !== 'string' || newPassword.length < 10) {
    res.status(400).json({ success: false, error: 'New password must be at least 10 characters' });
    return;
  }

  if (!(await verifyPassword(currentPassword))) {
    res.status(403).json({ success: false, error: 'Current password is incorrect' });
    return;
  }

  await changeAdminPassword(newPassword);
  await refreshAuthState();
  res.json({ success: true });
});

router.get('/notifications', (_req: Request, res: Response) => {
  const settings = getNotificationSettings();
  res.json({
    success: true,
    data: {
      ntfyUrl: settings.ntfyUrl,
      ntfyTopic: settings.ntfyTopic,
      telegramBotToken: settings.telegramBotToken ? '••••••' : '',
      telegramChatId: settings.telegramChatId,
      webhookUrl: settings.webhookUrl,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpUser: settings.smtpUser,
      smtpPass: settings.smtpPass ? '••••••' : '',
      smtpFrom: settings.smtpFrom,
      smtpTo: settings.smtpTo,
    },
  });
});

router.put('/notifications', (req: Request, res: Response) => {
  const body = req.body ?? {};
  updateNotificationSettings(body);
  res.json({ success: true });
});

const VALID_TEST_CHANNELS = ['ntfy', 'telegram', 'webhook', 'email'];

router.post('/notifications/test', async (req: Request, res: Response) => {
  const { channel } = req.body ?? {};
  if (!channel || !VALID_TEST_CHANNELS.includes(channel)) {
    res.status(400).json({ success: false, error: `channel must be one of: ${VALID_TEST_CHANNELS.join(', ')}` });
    return;
  }

  try {
    await sendNotification([channel], {
      ruleName: 'Test Notification',
      severity: 'info',
      value: 0,
      message: `This is a test notification from PiGuard (${getInstanceName()}).`,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Failed to send test notification' });
  }
});

const BLOCKED_PREFIXES = ['auth.', 'app.setup'];
const ALLOWED_PREFIXES = ['ui.', 'display.', 'dashboard.'];

router.put('/:key', (req: Request, res: Response) => {
  const key = req.params.key as string;
  const { value } = req.body ?? {};
  if (value === undefined) {
    res.status(400).json({ success: false, error: 'value is required' });
    return;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    res.status(400).json({ success: false, error: 'Invalid setting key' });
    return;
  }
  if (BLOCKED_PREFIXES.some((p) => key.startsWith(p))) {
    res.status(403).json({ success: false, error: 'This setting cannot be modified via this endpoint' });
    return;
  }
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    res.status(403).json({ success: false, error: 'Setting key not in allowed namespace' });
    return;
  }
  settingsRepo.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  res.json({ success: true });
});

export default router;
