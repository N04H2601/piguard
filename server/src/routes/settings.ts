import { Router, Request, Response } from 'express';
import { settingsRepo } from '../database/repositories.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: settingsRepo.getAll() });
});

router.put('/:key', (req: Request, res: Response) => {
  const key = req.params.key as string;
  const { value } = req.body ?? {};
  if (value === undefined) {
    res.status(400).json({ success: false, error: 'value is required' });
    return;
  }
  // Validate key format
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    res.status(400).json({ success: false, error: 'Invalid setting key' });
    return;
  }
  settingsRepo.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  res.json({ success: true });
});

export default router;
