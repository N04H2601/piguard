import rateLimit from 'express-rate-limit';

const defaultKeyGenerator = (req: { ip?: string; socket?: { remoteAddress?: string } }) =>
  req.ip ?? req.socket?.remoteAddress ?? 'unknown';

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests' },
  keyGenerator: defaultKeyGenerator,
});

export const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
  keyGenerator: defaultKeyGenerator,
});

export const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many AI requests. Try again later.' },
  keyGenerator: defaultKeyGenerator,
});
