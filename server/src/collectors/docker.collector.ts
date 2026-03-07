import { request } from 'http';
import { getLogger } from '../logger.js';

const DOCKER_SOCKET = '/var/run/docker.sock';

function dockerGet<T = any>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      { socketPath: DOCKER_SOCKET, path, method: 'GET', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Failed to parse Docker response for ${path}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Docker socket timeout')); });
    req.end();
  });
}

function dockerGetStream(path: string, timeoutMs = 2000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request(
      { socketPath: DOCKER_SOCKET, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => { res.destroy(); resolve(Buffer.concat(chunks)); }, timeoutMs);
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: number;
  ports: Array<{ ip: string; privatePort: number; publicPort?: number; type: string }>;
  labels: Record<string, string>;
  composeProject?: string;
}

function filterEnv(container: any): any {
  // Remove environment variables that might contain secrets
  if (container?.Config?.Env) {
    container.Config.Env = '[FILTERED]';
  }
  return container;
}

export async function listContainers(): Promise<ContainerInfo[]> {
  try {
    const containers = await dockerGet<any[]>('/containers/json?all=true');
    return containers.map(c => ({
      id: c.Id?.substring(0, 12) ?? '',
      name: (c.Names?.[0] ?? '').replace(/^\//, ''),
      image: c.Image ?? '',
      status: c.Status ?? '',
      state: c.State ?? '',
      created: c.Created ?? 0,
      ports: (c.Ports ?? []).map((p: any) => ({
        ip: p.IP ?? '',
        privatePort: p.PrivatePort ?? 0,
        publicPort: p.PublicPort,
        type: p.Type ?? '',
      })),
      labels: c.Labels ?? {},
      composeProject: c.Labels?.['com.docker.compose.project'],
    }));
  } catch (err) {
    getLogger().error({ err }, 'Failed to list Docker containers');
    return [];
  }
}

export async function getContainerStats(containerId: string) {
  try {
    const stats = await dockerGet(`/containers/${encodeURIComponent(containerId)}/stats?stream=false`);
    const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
    const cpuCount = stats.cpu_stats?.online_cpus ?? 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

    const memUsage = stats.memory_stats?.usage ?? 0;
    const memLimit = stats.memory_stats?.limit ?? 0;
    const memCache = stats.memory_stats?.stats?.cache ?? 0;

    const netRx = Object.values(stats.networks ?? {}).reduce((sum: number, n: any) => sum + (n.rx_bytes ?? 0), 0);
    const netTx = Object.values(stats.networks ?? {}).reduce((sum: number, n: any) => sum + (n.tx_bytes ?? 0), 0);

    const blockRead = (stats.blkio_stats?.io_service_bytes_recursive ?? [])
      .filter((s: any) => s.op === 'read' || s.op === 'Read')
      .reduce((sum: number, s: any) => sum + (s.value ?? 0), 0);
    const blockWrite = (stats.blkio_stats?.io_service_bytes_recursive ?? [])
      .filter((s: any) => s.op === 'write' || s.op === 'Write')
      .reduce((sum: number, s: any) => sum + (s.value ?? 0), 0);

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryUsage: memUsage - memCache,
      memoryLimit: memLimit,
      memoryPercent: memLimit > 0 ? Math.round(((memUsage - memCache) / memLimit) * 10000) / 100 : 0,
      netRx, netTx, blockRead, blockWrite,
    };
  } catch {
    return null;
  }
}

export async function getContainerLogs(containerId: string, tail = 100): Promise<string> {
  try {
    const data = await dockerGetStream(
      `/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`,
      5000
    );

    return decodeDockerLogStream(data);
  } catch {
    return '';
  }
}

export async function collectAllContainerStats() {
  const containers = await listContainers();
  const running = containers.filter(c => c.state === 'running');

  const statsPromises = running.map(async c => {
    const stats = await getContainerStats(c.id);
    return { ...c, stats };
  });

  return Promise.all(statsPromises);
}

function decodeDockerLogStream(payload: Buffer): string {
  if (payload.length === 0) return '';

  const decoded: string[] = [];
  let offset = 0;

  while (offset + 8 <= payload.length) {
    const streamType = payload[offset];
    const frameLength = payload.readUInt32BE(offset + 4);
    const frameStart = offset + 8;
    const frameEnd = frameStart + frameLength;

    if (![1, 2, 3].includes(streamType ?? -1) || frameEnd > payload.length) {
      return payload.toString('utf-8');
    }

    decoded.push(payload.subarray(frameStart, frameEnd).toString('utf-8'));
    offset = frameEnd;
  }

  if (offset < payload.length) {
    decoded.push(payload.subarray(offset).toString('utf-8'));
  }

  return decoded.join('');
}
