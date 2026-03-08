import { Router, Request, Response } from 'express';
import { alertsRepo } from '../database/repositories.js';
import { parseIdParam } from '../lib/params.js';

const router = Router();

router.get('/rules', (_req: Request, res: Response) => {
  res.json({ success: true, data: alertsRepo.getAllRules() });
});

router.post('/rules', (req: Request, res: Response) => {
  const { name, metric, condition, threshold, duration_s, cooldown_s, severity, channels } = req.body ?? {};
  if (!name || !metric || !condition || threshold === undefined) {
    res.status(400).json({ success: false, error: 'name, metric, condition, and threshold are required' });
    return;
  }
  const validConditions = ['>', '<', '>=', '<=', '=='];
  if (!validConditions.includes(condition)) {
    res.status(400).json({ success: false, error: `condition must be one of: ${validConditions.join(', ')}` });
    return;
  }
  alertsRepo.createRule({ name, metric, condition, threshold, duration_s, cooldown_s, severity, channels });
  res.json({ success: true });
});

router.put('/rules/:id', (req: Request, res: Response) => {
  const id = parseIdParam(req, res);
  if (id === null) return;
  const allowed = ['name', 'metric', 'condition', 'threshold', 'duration_s', 'cooldown_s', 'severity', 'enabled', 'channels'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }
  alertsRepo.updateRule(id, updates);
  res.json({ success: true });
});

router.delete('/rules/:id', (req: Request, res: Response) => {
  const id = parseIdParam(req, res);
  if (id === null) return;
  alertsRepo.deleteRule(id);
  res.json({ success: true });
});

router.get('/history', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
  res.json({ success: true, data: alertsRepo.getHistory(limit) });
});

router.delete('/history', (_req: Request, res: Response) => {
  alertsRepo.clearHistory();
  res.json({ success: true });
});

router.get('/active', (_req: Request, res: Response) => {
  res.json({ success: true, data: alertsRepo.getActive() });
});

router.post('/acknowledge/:id', (req: Request, res: Response) => {
  const id = parseIdParam(req, res);
  if (id === null) return;
  alertsRepo.acknowledgeAlert(id);
  res.json({ success: true });
});

export default router;
