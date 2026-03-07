import { Router, Request, Response } from 'express';
import { listContainers, getContainerStats, getContainerLogs, collectAllContainerStats } from '../collectors/docker.collector.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const containers = await listContainers();
  res.json({ success: true, data: containers });
});

router.get('/stats', async (_req: Request, res: Response) => {
  const data = await collectAllContainerStats();
  res.json({ success: true, data });
});

router.get('/:id/stats', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!/^[a-f0-9]+$/i.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid container ID' });
    return;
  }
  const stats = await getContainerStats(id);
  if (!stats) {
    res.status(404).json({ success: false, error: 'Container not found or not running' });
    return;
  }
  res.json({ success: true, data: stats });
});

router.get('/:id/logs', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!/^[a-f0-9]+$/i.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid container ID' });
    return;
  }
  const tail = Math.min(parseInt(req.query.tail as string) || 100, 5000);
  const logs = await getContainerLogs(id, tail);
  res.json({ success: true, data: { logs } });
});

export default router;
