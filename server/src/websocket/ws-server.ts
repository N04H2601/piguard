import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { parse as parseCookie } from 'cookie';
import { verifyToken } from '../services/auth.service.js';
import { getLogger } from '../logger.js';
import { getCurrentSnapshot, subscribeSystemUpdates } from '../services/system-monitor.service.js';

let wss: WebSocketServer;
let unsubscribeSystemUpdates: (() => void) | null = null;

export function initWebSocket(server: Server) {
  const log = getLogger();

  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    // Auth: verify JWT from cookie
    const cookies = parseCookie(req.headers.cookie ?? '');
    const token = cookies['piguard_session'];

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    const payload = await verifyToken(token);
    if (!payload) {
      ws.close(4001, 'Invalid session');
      return;
    }

    log.info({ user: payload.sub }, 'WebSocket client connected');

    // Send initial data
    try {
      const data = await getCurrentSnapshot();
      ws.send(JSON.stringify({ type: 'system', data }));
    } catch { /* ignore initial send failure */ }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(ws, msg);
      } catch { /* ignore malformed messages */ }
    });

    ws.on('close', () => {
      log.debug('WebSocket client disconnected');
    });
  });

  unsubscribeSystemUpdates = subscribeSystemUpdates(({ data, anomalies }) => {
    if (wss.clients.size === 0) return;

    const message = JSON.stringify({
        type: 'system',
        data,
        anomalies,
      });

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  });

  log.info('WebSocket server initialized');
}

function handleMessage(ws: WebSocket, msg: any) {
  switch (msg.type) {
    case 'subscribe':
      // Future: per-channel subscriptions
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
  }
}

export function closeWebSocket() {
  unsubscribeSystemUpdates?.();
  unsubscribeSystemUpdates = null;
  if (wss) wss.close();
}
