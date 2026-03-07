import { Router, Request, Response } from 'express';
import { healthChecksRepo } from '../database/repositories.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const checks = healthChecksRepo.getAll();
  res.json({ success: true, data: checks });
});

router.post('/', (req: Request, res: Response) => {
  const { name, type, target, interval_s, timeout_ms, expected_status } = req.body ?? {};
  if (!name || !type || !target) {
    res.status(400).json({ success: false, error: 'name, type, and target are required' });
    return;
  }
  const validTypes = ['http', 'tcp', 'dns', 'icmp'];
  if (!validTypes.includes(type)) {
    res.status(400).json({ success: false, error: `type must be one of: ${validTypes.join(', ')}` });
    return;
  }
  const result = healthChecksRepo.create({ name, type, target, interval_s, timeout_ms, expected_status });
  res.json({ success: true, data: { id: result.lastInsertRowid } });
});

router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const allowed = ['name', 'type', 'target', 'interval_s', 'timeout_ms', 'expected_status', 'enabled'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ success: false, error: 'No valid fields to update' });
    return;
  }
  healthChecksRepo.update(id, updates);
  res.json({ success: true });
});

router.delete('/:id', (req: Request, res: Response) => {
  healthChecksRepo.delete(Number(req.params.id));
  res.json({ success: true });
});

router.get('/:id/results', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
  const results = healthChecksRepo.getResults(Number(req.params.id), limit);
  res.json({ success: true, data: results });
});

router.get('/:id/uptime', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const day = 86400000;
  res.json({
    success: true,
    data: {
      '24h': healthChecksRepo.getUptime(id, day),
      '7d': healthChecksRepo.getUptime(id, 7 * day),
      '30d': healthChecksRepo.getUptime(id, 30 * day),
      '90d': healthChecksRepo.getUptime(id, 90 * day),
    },
  });
});

export default router;
