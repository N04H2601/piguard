import { Router, Request, Response } from 'express';
import { collectInterfaces, collectConnections, collectWireGuard, collectArpTable } from '../collectors/network.collector.js';
import { arpRepo } from '../database/repositories.js';

const router = Router();

router.get('/interfaces', (_req: Request, res: Response) => {
  res.json({ success: true, data: collectInterfaces() });
});

router.get('/connections', async (_req: Request, res: Response) => {
  const data = await collectConnections();
  res.json({ success: true, data });
});

router.get('/wireguard', async (_req: Request, res: Response) => {
  const data = await collectWireGuard();
  res.json({ success: true, data });
});

router.get('/arp', (_req: Request, res: Response) => {
  const live = collectArpTable();
  // Update DB
  for (const entry of live) {
    if (entry.mac && entry.ip) {
      arpRepo.upsert(entry.mac, entry.ip);
    }
  }
  const devices = arpRepo.getAll();
  res.json({ success: true, data: { live, devices } });
});

router.post('/arp/:mac/known', (req: Request, res: Response) => {
  const mac = req.params.mac as string;
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) {
    res.status(400).json({ success: false, error: 'Invalid MAC address' });
    return;
  }
  const { alias } = req.body ?? {};
  arpRepo.setKnown(mac, true, alias);
  res.json({ success: true });
});

export default router;
