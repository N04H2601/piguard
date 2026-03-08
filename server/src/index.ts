import { createServer } from 'http';
import { loadConfig } from './config.js';
import { initLogger, getLogger } from './logger.js';
import { closeDatabase, initDatabase } from './database/init.js';
import { initAuth, refreshAuthState } from './services/auth.service.js';
import { createApp } from './app.js';
import { initWebSocket, closeWebSocket } from './websocket/ws-server.js';
import { startHealthChecks, stopHealthChecks, seedDefaultChecks } from './services/health-check.service.js';
import { startAlertEngine, stopAlertEngine, seedDefaultRules } from './services/alert.service.js';
import { aiChatRepo, healthChecksRepo, loginRepo, metricsRepo, nginxStatsRepo, revokedTokensRepo, securityRepo } from './database/repositories.js';
import { startSystemMonitor, stopSystemMonitor } from './services/system-monitor.service.js';
import { bootstrapLegacySetupFromEnv } from './services/setup.service.js';
import { startSecurityEventMonitor, stopSecurityEventMonitor } from './services/security-events.service.js';

async function main() {
  // Load config first (fails fast if invalid)
  const config = loadConfig();
  const log = initLogger();

  log.info({ port: config.PORT, env: config.NODE_ENV }, 'Starting piguard');

  // Init database
  initDatabase();

  // Init auth
  await initAuth();
  await bootstrapLegacySetupFromEnv();
  await refreshAuthState();

  // Seed defaults
  seedDefaultChecks();
  seedDefaultRules();

  // Create Express app
  const app = createApp();
  const server = createServer(app);

  // WebSocket
  initWebSocket(server);

  // Start services
  await startSystemMonitor();
  startHealthChecks();
  startAlertEngine();
  startSecurityEventMonitor();

  // Periodic cleanup (every hour)
  setInterval(() => {
    try {
      metricsRepo.downsample();
      metricsRepo.cleanup(90);
      healthChecksRepo.cleanupResults(30);
      securityRepo.cleanup(30);
      loginRepo.cleanup(90);
      nginxStatsRepo.cleanup(30);
      aiChatRepo.cleanupArchivedEmpty(30);
      revokedTokensRepo.cleanup();
    } catch (err) {
      log.error({ err }, 'Cleanup error');
    }
  }, 3600000);

  // Start server
  server.listen(config.PORT, '0.0.0.0', () => {
    log.info({ port: config.PORT }, 'Server listening');
  });

  // Graceful shutdown
  const shutdown = () => {
    log.info('Shutting down...');
    stopSystemMonitor();
    stopHealthChecks();
    stopAlertEngine();
    stopSecurityEventMonitor();
    closeWebSocket();
    closeDatabase();
    server.close(() => {
      log.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
