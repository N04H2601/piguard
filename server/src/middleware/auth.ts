import { Request, Response, NextFunction } from 'express';
import { verifyToken, verifyApiKey } from '../services/auth.service.js';
import { isSetupComplete } from '../services/setup.service.js';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Public endpoints
  // req.path is relative to mount point (/api/v1)
  if (
    req.path === '/health'
    || req.path === '/auth/login'
    || req.path === '/auth/csrf'
    || req.path === '/auth/setup-status'
    || (!isSetupComplete() && req.path === '/auth/setup')
  ) {
    next();
    return;
  }

  // Check API key header
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    const record = verifyApiKey(apiKey);
    if (record) {
      (req as any).user = { sub: 'api-key', keyId: (record as any).id };
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid API key' });
    return;
  }

  // Check session cookie
  const token = req.cookies?.piguard_session;
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const payload = await verifyToken(token);
  if (!payload) {
    res.clearCookie('piguard_session');
    res.status(401).json({ success: false, error: 'Invalid or expired session' });
    return;
  }

  (req as any).user = payload;
  next();
}
