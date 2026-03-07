import helmet from 'helmet';
import cors from 'cors';
import { getConfig, isCookieSecure } from '../config.js';
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

export function securityMiddleware() {
  const config = getConfig();
  const origins = config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

  return [
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'wss:', 'ws:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
    cors({
      origin: origins.length > 0 ? origins : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'X-CSRF-Token'],
    }),
  ];
}

export function ensureCsrfToken(req: Request, res: Response): string {
  const existing = req.cookies?.piguard_csrf;

  if (existing) return existing;

  const token = randomBytes(32).toString('hex');
  res.cookie('piguard_csrf', token, {
    httpOnly: false,
    secure: isCookieSecure(req),
    sameSite: 'strict',
    path: '/',
  });
  return token;
}

// CSRF double-submit cookie
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip for API key auth
  if (req.headers['x-api-key']) {
    next();
    return;
  }

  // Skip CSRF for login endpoint (no session yet to protect)
  if (req.path === '/api/v1/auth/login') {
    next();
    return;
  }

  // Skip for GET/HEAD/OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.locals.csrfToken = ensureCsrfToken(req, res);
    next();
    return;
  }

  // For mutations, verify CSRF token
  const cookieToken = req.cookies?.piguard_csrf;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ success: false, error: 'CSRF validation failed' });
    return;
  }

  next();
}
