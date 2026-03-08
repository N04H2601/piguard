import { Request, Response, NextFunction } from 'express';
import { getLogger } from '../logger.js';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const log = getLogger();
  log.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
}
