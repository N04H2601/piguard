import { collectAll } from '../collectors/system.collector.js';
import { metricsRepo } from '../database/repositories.js';
import { addSample } from './anomaly.service.js';
import { getLogger } from '../logger.js';

export type SystemSnapshot = Awaited<ReturnType<typeof collectAll>>;
export type SystemUpdate = {
  data: SystemSnapshot;
  anomalies?: Record<string, { isAnomaly: boolean; zScore: number }>;
};

type Listener = (update: SystemUpdate) => void;

const listeners = new Set<Listener>();

let latestSnapshot: SystemSnapshot | null = null;
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let collecting = false;

export async function startSystemMonitor(): Promise<void> {
  if (monitorInterval) return;

  const log = getLogger();
  log.info('Starting system monitor');

  await collectCycle();
  monitorInterval = setInterval(() => {
    void collectCycle();
  }, 5000);
}

export function stopSystemMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export function subscribeSystemUpdates(listener: Listener): () => void {
  listeners.add(listener);
  if (latestSnapshot) {
    listener({ data: latestSnapshot });
  }
  return () => listeners.delete(listener);
}

export async function getCurrentSnapshot(): Promise<SystemSnapshot> {
  if (!latestSnapshot) {
    await collectCycle();
  }
  return latestSnapshot!;
}

async function collectCycle(): Promise<void> {
  if (collecting) return;
  collecting = true;

  const log = getLogger();

  try {
    const data = await collectAll();
    latestSnapshot = data;

    const entries = buildMetricEntries(data);
    if (entries.length > 0) {
      metricsRepo.insertBatch(entries);
    }

    const anomalies = detectAnomalies(entries);
    const update: SystemUpdate = {
      data,
      anomalies: Object.keys(anomalies).length > 0 ? anomalies : undefined,
    };

    for (const listener of listeners) {
      listener(update);
    }
  } catch (err) {
    log.error({ err }, 'System monitor cycle failed');
  } finally {
    collecting = false;
  }
}

function buildMetricEntries(data: SystemSnapshot): Array<{
  metric: string;
  value: number;
  labels?: Record<string, string>;
}> {
  const entries: Array<{ metric: string; value: number; labels?: Record<string, string> }> = [
    { metric: 'cpu.overall', value: data.cpu.overall },
    { metric: 'memory.usedPercent', value: data.memory.usedPercent },
    { metric: 'memory.used', value: data.memory.used },
    { metric: 'uptime.seconds', value: data.uptime.seconds },
  ];

  if (data.temperature.temp !== null) {
    entries.push({ metric: 'temperature.temp', value: data.temperature.temp });
  }

  if (data.disk.length > 0) {
    const busiestDisk = data.disk.reduce((max, current) =>
      current.usedPercent > max.usedPercent ? current : max
    );

    entries.push(
      { metric: 'disk.usedPercent', value: busiestDisk.usedPercent },
      {
        metric: 'disk.readIops',
        value: data.disk.reduce((sum, disk) => sum + disk.readIops, 0),
      },
      {
        metric: 'disk.writeIops',
        value: data.disk.reduce((sum, disk) => sum + disk.writeIops, 0),
      },
    );

    for (const disk of data.disk) {
      const labels = { device: disk.device, mount: disk.mount };
      const prefix = `disk.${sanitizeMetricSegment(disk.name)}`;
      entries.push(
        { metric: `${prefix}.usedPercent`, value: disk.usedPercent, labels },
        { metric: `${prefix}.readIops`, value: disk.readIops, labels },
        { metric: `${prefix}.writeIops`, value: disk.writeIops, labels },
        { metric: `${prefix}.readBps`, value: disk.readBps, labels },
        { metric: `${prefix}.writeBps`, value: disk.writeBps, labels },
      );
    }
  }

  for (const iface of data.network) {
    const labels = { interface: iface.name };
    const prefix = `network.${sanitizeMetricSegment(iface.name)}`;
    entries.push(
      { metric: `${prefix}.rxRate`, value: iface.rxRate, labels },
      { metric: `${prefix}.txRate`, value: iface.txRate, labels },
      { metric: `${prefix}.rxBytes`, value: iface.rxBytes, labels },
      { metric: `${prefix}.txBytes`, value: iface.txBytes, labels },
    );
  }

  return entries;
}

function detectAnomalies(entries: Array<{ metric: string; value: number }>) {
  const anomalies: Record<string, { isAnomaly: boolean; zScore: number }> = {};

  for (const entry of entries) {
    const result = addSample(entry.metric, entry.value);
    if (result.isAnomaly) {
      anomalies[entry.metric] = result;
    }
  }

  return anomalies;
}

function sanitizeMetricSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}
