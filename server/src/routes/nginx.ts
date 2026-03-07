import { Router, Request, Response } from 'express';
import { parseAccessLogDelta, parseErrorLog, detectVhosts, aggregateStats } from '../collectors/nginx.collector.js';
import { nginxStatsRepo } from '../database/repositories.js';

const router = Router();

let recentEntries: any[] = [];

router.get('/stats', async (_req: Request, res: Response) => {
  const entries = await parseAccessLogDelta();
  recentEntries = [...recentEntries, ...entries].slice(-5000);

  const stats = aggregateStats(recentEntries);
  if (entries.length > 0) {
    const deltaStats = aggregateStats(entries);
    nginxStatsRepo.insert({
      requests: deltaStats.totalRequests,
      status_2xx: deltaStats.statusCodes['2xx'],
      status_3xx: deltaStats.statusCodes['3xx'],
      status_4xx: deltaStats.statusCodes['4xx'],
      status_5xx: deltaStats.statusCodes['5xx'],
      bytes_sent: deltaStats.totalBytes,
    });
  }

  res.json({ success: true, data: stats });
});

router.get('/errors', async (_req: Request, res: Response) => {
  const errors = await parseErrorLog();
  res.json({ success: true, data: errors });
});

router.get('/vhosts', (_req: Request, res: Response) => {
  const vhosts = detectVhosts();
  res.json({ success: true, data: vhosts });
});

router.get('/history', (req: Request, res: Response) => {
  const from = parseInt(req.query.from as string) || Date.now() - 86400000;
  const to = parseInt(req.query.to as string) || Date.now();
  const vhost = req.query.vhost as string | undefined;
  const data = nginxStatsRepo.query(from, to, vhost);
  res.json({ success: true, data });
});

export default router;
