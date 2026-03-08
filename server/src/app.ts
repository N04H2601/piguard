import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve } from 'path';
import { existsSync } from 'fs';

import { securityMiddleware, csrfMiddleware } from './middleware/security.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { getTrustProxyConfig } from './config.js';

import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import statsRoutes from './routes/stats.js';
import dockerRoutes from './routes/docker.js';
import networkRoutes from './routes/network.js';
import checksRoutes from './routes/checks.js';
import securityRoutes from './routes/security.js';
import nginxRoutes from './routes/nginx.js';
import alertsRoutes from './routes/alerts.js';
import nodesRoutes from './routes/nodes.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', getTrustProxyConfig());

  // Security
  app.use(...securityMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(globalLimiter);

  // CSRF for browser requests
  app.use(csrfMiddleware);

  // Auth (public routes exempted inside middleware)
  app.use('/api/v1', authMiddleware);

  // Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1/stats', statsRoutes);
  app.use('/api/v1/docker', dockerRoutes);
  app.use('/api/v1/network', networkRoutes);
  app.use('/api/v1/checks', checksRoutes);
  app.use('/api/v1/security', securityRoutes);
  app.use('/api/v1/nginx', nginxRoutes);
  app.use('/api/v1/alerts', alertsRoutes);
  app.use('/api/v1/nodes', nodesRoutes);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/ai', aiRoutes);

  // Serve static client files in production
  const clientDir = resolve(import.meta.dirname ?? '.', '../../dist/client');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => {
      res.sendFile(resolve(clientDir, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
