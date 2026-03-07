import { Router, Request, Response } from 'express';
import { parseAuthLog, collectFail2ban, collectSecurityScore } from '../collectors/security.collector.js';
import { securityRepo } from '../database/repositories.js';

const router = Router();

router.get('/events', (req: Request, res: Response) => {
  const type = req.query.type as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
  const events = securityRepo.getEvents(limit, type);
  res.json({ success: true, data: events });
});

router.get('/auth-log', (_req: Request, res: Response) => {
  const events = parseAuthLog();
  res.json({ success: true, data: events });
});

router.get('/fail2ban', async (_req: Request, res: Response) => {
  const jails = await collectFail2ban();
  res.json({ success: true, data: jails });
});

router.get('/score', async (_req: Request, res: Response) => {
  const score = await collectSecurityScore();
  res.json({ success: true, data: score });
});

export default router;
