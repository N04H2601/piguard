import { apiFetch } from '../lib/api.js';
import { setState } from './store.js';

let summaryInterval: ReturnType<typeof setInterval> | null = null;
let syncing = false;

export function startSummarySync() {
  if (summaryInterval) return;
  void refreshSummary();
  summaryInterval = setInterval(() => {
    void refreshSummary();
  }, 10000);
}

export function stopSummarySync() {
  if (summaryInterval) {
    clearInterval(summaryInterval);
    summaryInterval = null;
  }
}

export async function refreshSummary() {
  if (syncing) return;
  syncing = true;

  try {
    const [activeAlerts, checks] = await Promise.all([
      apiFetch<any[]>('/api/v1/alerts/active'),
      apiFetch<any[]>('/api/v1/checks'),
    ]);

    const servicesDown = checks.filter((check) => check.enabled && check.last_status === 'down').length;
    setState({
      activeAlerts: activeAlerts.length,
      servicesDown,
      authError: null,
    });
  } catch {
    // The API helper already normalizes auth failures.
  } finally {
    syncing = false;
  }
}
