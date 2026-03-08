import { Router, Request, Response } from 'express';
import { settingsRepo } from '../database/repositories.js';
import {
  getInstanceName, setInstanceName,
  getAppLanguage, setAppLanguage,
  changeAdminPassword, getNotificationSettings, updateNotificationSettings, getAiSettings, updateAiSettings,
} from '../services/setup.service.js';
import { refreshAuthState, verifyPassword } from '../services/auth.service.js';
import { sendNotification, sendTestEmail } from '../services/notification.service.js';
import { getPasswordPolicyError } from '../lib/password-policy.js';
import { normalizeNotificationSettingsInput, validateNotificationSettings } from '../lib/notification-settings.js';

const router = Router();
const MASKED_VALUE = '••••••';

router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: settingsRepo.getAll().filter((entry: any) => !isSensitiveSettingKey(entry.key)),
  });
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

  if (typeof newPassword !== 'string') {
    res.status(400).json({ success: false, error: 'newPassword must be a string' });
    return;
  }

  const passwordError = getPasswordPolicyError(newPassword);
  if (passwordError) {
    res.status(400).json({ success: false, error: passwordError });
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
      telegramBotToken: settings.telegramBotToken ? '••••••' : '',
      telegramChatId: settings.telegramChatId,
      smtpProvider: settings.smtpProvider,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpUser: settings.smtpUser,
      smtpPass: settings.smtpPass ? '••••••' : '',
      smtpFrom: settings.smtpFrom,
      smtpTo: settings.smtpTo,
      smtpTls: settings.smtpTls,
    },
  });
});

router.put('/notifications', (req: Request, res: Response) => {
  const settings = normalizeNotificationSettingsInput(req.body ?? {});
  const validationError = validateNotificationSettings(settings);
  if (validationError) {
    res.status(400).json({ success: false, error: validationError });
    return;
  }

  updateNotificationSettings({
    telegramBotToken: settings.telegramBotToken,
    telegramChatId: settings.telegramChatId,
    smtpProvider: settings.smtpProvider,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPass: settings.smtpPass,
    smtpFrom: settings.smtpFrom,
    smtpTo: settings.smtpTo,
    smtpTls: settings.smtpTls,
  });
  res.json({ success: true });
});

router.get('/ai', (_req: Request, res: Response) => {
  const settings = getAiSettings();
  res.json({
    success: true,
    data: {
      openaiApiKey: settings.openaiApiKey ? MASKED_VALUE : '',
      openaiModel: settings.openaiModel,
      configured: Boolean(settings.openaiApiKey),
    },
  });
});

router.put('/ai', (req: Request, res: Response) => {
  const openaiApiKey = req.body?.openaiApiKey;
  const openaiModel = req.body?.openaiModel;

  if (openaiApiKey !== undefined && typeof openaiApiKey !== 'string') {
    res.status(400).json({ success: false, error: 'openaiApiKey must be a string' });
    return;
  }

  if (openaiModel !== undefined && typeof openaiModel !== 'string') {
    res.status(400).json({ success: false, error: 'openaiModel must be a string' });
    return;
  }

  updateAiSettings({
    openaiApiKey,
    openaiModel,
  });
  res.json({ success: true });
});

const VALID_TEST_CHANNELS = ['telegram', 'email'];

router.post('/notifications/test', async (req: Request, res: Response) => {
  const { channel } = req.body ?? {};
  if (!channel || !VALID_TEST_CHANNELS.includes(channel)) {
    res.status(400).json({ success: false, error: `channel must be one of: ${VALID_TEST_CHANNELS.join(', ')}` });
    return;
  }

  try {
    if (channel === 'email') {
      const existing = getNotificationSettings();
      const body = req.body ?? {};
      const settings = normalizeNotificationSettingsInput({
        ...existing,
        ...body,
        smtpProvider: body.smtpProvider ?? existing.smtpProvider,
        smtpHost: body.smtpHost ?? existing.smtpHost,
        smtpPort: body.smtpPort ?? existing.smtpPort,
        smtpUser: body.smtpUser === MASKED_VALUE ? existing.smtpUser : (body.smtpUser ?? existing.smtpUser),
        smtpPass: body.smtpPass === MASKED_VALUE ? existing.smtpPass : (body.smtpPass ?? existing.smtpPass),
        smtpFrom: body.smtpFrom ?? existing.smtpFrom,
        smtpTo: body.smtpTo ?? existing.smtpTo,
        smtpTls: body.smtpTls ?? existing.smtpTls,
      });
      const validationError = validateNotificationSettings(settings);
      if (validationError) {
        res.status(400).json({ success: false, error: validationError });
        return;
      }

      await sendTestEmail(settings, getInstanceName());
      res.json({ success: true, data: { message: `Test email sent to ${settings.smtpTo}` } });
      return;
    }

    await sendNotification([channel], {
      ruleName: 'Test Notification',
      severity: 'info',
      value: 0,
      message: `This is a test notification from PiGuard (${getInstanceName()}).`,
      timestamp: new Date().toISOString(),
    }, { throwOnError: true });
    res.json({ success: true, data: { message: 'Test Telegram notification sent' } });
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

function isSensitiveSettingKey(key: string) {
  return key.startsWith('auth.')
    || key === 'notify.smtp_pass'
    || key === 'notify.telegram_bot_token'
    || key === 'ai.openai_api_key';
}
