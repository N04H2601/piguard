import { Router, Request, Response } from 'express';
import { hostname } from 'os';

const router = Router();

// Phase 8 stub - only returns local node
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      {
        id: 'local',
        name: hostname(),
        status: 'online',
        type: 'local',
      },
    ],
  });
});

export default router;
