import { Router, Request, Response } from 'express';
import { metricsRepo } from '../database/repositories.js';
import { getCurrentSnapshot } from '../services/system-monitor.service.js';

const router = Router();

router.get('/current', async (_req: Request, res: Response) => {
  const data = await getCurrentSnapshot();
  res.json({ success: true, data });
});

router.get('/history', (req: Request, res: Response) => {
  const metric = req.query.metric as string;
  const from = parseInt(req.query.from as string) || Date.now() - 3600000;
  const to = parseInt(req.query.to as string) || Date.now();
  const nodeId = (req.query.node as string) || 'local';
  const limit = Math.min(parseInt(req.query.limit as string) || 1000, 5000);

  if (!metric) {
    res.status(400).json({ success: false, error: 'metric parameter required' });
    return;
  }

  const data = metricsRepo.query(metric, from, to, nodeId, limit);
  res.json({ success: true, data });
});

router.get('/export', (req: Request, res: Response) => {
  const metric = req.query.metric as string;
  const from = parseInt(req.query.from as string) || Date.now() - 86400000;
  const to = parseInt(req.query.to as string) || Date.now();
  const format = (req.query.format as string) || 'json';

  if (!metric) {
    res.status(400).json({ success: false, error: 'metric parameter required' });
    return;
  }

  const data = metricsRepo.query(metric, from, to, 'local', 50000);

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${metric}.csv"`);
    res.write('timestamp,value,labels\n');
    for (const row of data) {
      res.write(`${(row as any).timestamp},${(row as any).value},"${(row as any).labels}"\n`);
    }
    res.end();
    return;
  }

  res.json({ success: true, data });
});

export default router;
