import { setState } from './store.js';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let manualClose = false;

type MessageHandler = (data: any) => void;
const handlers = new Map<string, Set<MessageHandler>>();

export function connectWs() {
  if (ws?.readyState === WebSocket.OPEN) return;
  manualClose = false;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    setState({ wsConnected: true, authError: null });
    reconnectDelay = 1000;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'system') {
        setState({ systemData: msg.data, anomalies: msg.anomalies ?? {} });
      }
      const typeHandlers = handlers.get(msg.type);
      if (typeHandlers) {
        for (const fn of typeHandlers) fn(msg);
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    setState({ wsConnected: false });
    if (!manualClose) {
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connectWs();
  }, reconnectDelay);
}

export function disconnectWs() {
  manualClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}

export function onWsMessage(type: string, fn: MessageHandler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

export function sendWs(data: any) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
