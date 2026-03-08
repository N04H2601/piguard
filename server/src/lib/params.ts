import { Request, Response } from 'express';

export function parseIdParam(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid id parameter' });
    return null;
  }
  return id;
}
