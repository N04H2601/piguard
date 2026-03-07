import { Router, Request, Response } from 'express';
import { uptime } from 'process';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: Math.floor(uptime()),
      timestamp: Date.now(),
      version: '1.0.0',
    },
  });
});

export default router;
