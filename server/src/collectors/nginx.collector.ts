import { request } from 'http';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'fs';
import { dirname, join } from 'path';

const DOCKER_SOCKET = '/var/run/docker.sock';
const NGINX_CONTAINER_NAME = process.env.NGINX_CONTAINER_NAME || 'nginx';
const INITIAL_TAIL = 200;
const STREAM_TAIL = 500;

let accessCursor = '';
let errorCursor = '';
let hostAccessOffset = 0;
let hostAccessInode = 0;
let hostErrorOffset = 0;
let hostErrorInode = 0;

interface NginxLogEntry {
  ip: string;
  timestamp: string;
  method: string;
  uri: string;
  status: number;
  bytes: number;
  referer: string;
  userAgent: string;
  vhost: string;
}

interface DockerLogLine {
  cursor: string;
  message: string;
}

export async function parseAccessLogDelta(): Promise<NginxLogEntry[]> {
  const lines = await readContainerLogs({ stdout: true, stderr: false, cursor: accessCursor });
  if (lines.length > 0) {
    accessCursor = lines.at(-1)?.cursor ?? accessCursor;
  }

  const sourceLines = lines.length > 0 ? lines : readHostLogDelta([
    '/host/root/var/log/nginx/access.log',
    '/var/log/nginx/access.log',
  ], 'access');
  const entries: NginxLogEntry[] = [];
  const regex = /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+\S+"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;

  for (const line of sourceLines) {
    const message = typeof line === 'string' ? line : line.message;
    const match = regex.exec(message);
    if (!match) continue;
    entries.push({
      ip: match[1] ?? '',
      vhost: match[3] === '-' ? 'default' : (match[3] ?? 'default'),
      timestamp: match[4] ?? '',
      method: match[5] ?? '',
      uri: match[6] ?? '',
      status: parseInt(match[7] ?? '0', 10),
      bytes: parseInt(match[8] ?? '0', 10),
      referer: match[9] ?? '',
      userAgent: match[10] ?? '',
    });
  }

  return entries;
}

export async function parseErrorLog(lastN = 50): Promise<string[]> {
  const lines = await readContainerLogs({ stdout: false, stderr: true, cursor: errorCursor });
  if (lines.length > 0) {
    errorCursor = lines.at(-1)?.cursor ?? errorCursor;
  }
  if (lines.length > 0) {
    return lines.map((line) => line.message).slice(-lastN);
  }
  return readHostLogDelta([
    '/host/root/var/log/nginx/error.log',
    '/var/log/nginx/error.log',
  ], 'error').slice(-lastN);
}

export function detectVhosts(sitesDir = '/etc/nginx/sites-enabled'): string[] {
  const parseServerNames = (content: string) => [...new Set(
    [...content.matchAll(/server_name\s+([^;]+);/g)]
      .flatMap((match) => (match[1] ?? '').split(/\s+/))
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];

  try {
    return readdirSync(sitesDir).filter((entry) => entry !== '.' && entry !== '..');
  } catch {
    const candidateFiles = [
      '/host/root/etc/nginx/nginx.conf',
    ];
    const candidateDirs = [
      '/host/root/etc/nginx/sites-enabled',
      '/host/root/etc/nginx/conf.d',
    ];

    for (const file of candidateFiles) {
      try {
        const names = parseServerNames(readFileSync(file, 'utf-8'));
        if (names.length > 0) return names;
      } catch {
        // Try next path.
      }
    }

    for (const dir of candidateDirs) {
      try {
        const names = new Set<string>();
        for (const entry of readdirSync(dir)) {
          const path = join(dir, entry);
          const content = readMountedConfig(path);
          if (!content) continue;
          for (const name of parseServerNames(content)) {
            names.add(name);
          }
        }
        if (names.size > 0) return [...names];
      } catch {
        // Try next directory.
      }
    }

    return [];
  }
}

export function aggregateStats(entries: NginxLogEntry[]) {
  const stats = {
    totalRequests: entries.length,
    websocketConnections: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
    totalBytes: 0,
    topUris: new Map<string, number>(),
    topIps: new Map<string, number>(),
    topUserAgents: new Map<string, number>(),
    topVhosts: new Map<string, number>(),
    methodCounts: new Map<string, number>(),
  };

  for (const entry of entries) {
    const isWebSocket = entry.uri === '/ws' || entry.uri.startsWith('/ws?');

    if (entry.status >= 200 && entry.status < 300) stats.status2xx++;
    else if (entry.status >= 300 && entry.status < 400) stats.status3xx++;
    else if (entry.status >= 400 && entry.status < 500) stats.status4xx++;
    else if (entry.status >= 500) stats.status5xx++;

    stats.totalBytes += entry.bytes;
    if (isWebSocket) {
      stats.websocketConnections++;
    } else {
      stats.topUris.set(entry.uri, (stats.topUris.get(entry.uri) ?? 0) + 1);
    }
    stats.topIps.set(entry.ip, (stats.topIps.get(entry.ip) ?? 0) + 1);
    stats.topUserAgents.set(entry.userAgent, (stats.topUserAgents.get(entry.userAgent) ?? 0) + 1);
    stats.topVhosts.set(entry.vhost, (stats.topVhosts.get(entry.vhost) ?? 0) + 1);
    stats.methodCounts.set(entry.method, (stats.methodCounts.get(entry.method) ?? 0) + 1);
  }

  const sortMap = (map: Map<string, number>, limit = 10) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ key, count }));

  return {
    totalRequests: stats.totalRequests,
    websocketConnections: stats.websocketConnections,
    statusCodes: { '2xx': stats.status2xx, '3xx': stats.status3xx, '4xx': stats.status4xx, '5xx': stats.status5xx },
    totalBytes: stats.totalBytes,
    topUris: sortMap(stats.topUris),
    topIps: sortMap(stats.topIps),
    topUserAgents: sortMap(stats.topUserAgents, 5),
    topVhosts: sortMap(stats.topVhosts, 5),
    methods: Object.fromEntries(stats.methodCounts),
  };
}

async function readContainerLogs(options: { stdout: boolean; stderr: boolean; cursor: string }): Promise<DockerLogLine[]> {
  const containerId = await discoverNginxContainerId();
  if (!containerId) return [];

  const tail = options.cursor ? STREAM_TAIL : INITIAL_TAIL;
  const query = new URLSearchParams({
    stdout: options.stdout ? 'true' : 'false',
    stderr: options.stderr ? 'true' : 'false',
    timestamps: 'true',
    tail: String(tail),
  });

  const payload = await dockerGetBuffer(`/containers/${encodeURIComponent(containerId)}/logs?${query.toString()}`);
  return decodeDockerLogStream(payload, options.cursor);
}

async function findContainerIdByName(name: string): Promise<string | null> {
  try {
    const payload = await dockerGetJson<any[]>('/containers/json?all=true');
    const match = payload.find((container) => (container.Names ?? []).some((entry: string) => entry === `/${name}`));
    return match?.Id ?? null;
  } catch {
    return null;
  }
}

async function discoverNginxContainerId(): Promise<string | null> {
  const configured = await findContainerIdByName(NGINX_CONTAINER_NAME);
  if (configured) return configured;

  try {
    const payload = await dockerGetJson<any[]>('/containers/json?all=true');
    const ranked = payload
      .map((container) => ({ id: container.Id as string, score: scoreContainer(container) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return ranked[0]?.id ?? null;
  } catch {
    return null;
  }
}

function scoreContainer(container: any): number {
  const names = (container.Names ?? []).join(' ').toLowerCase();
  const image = String(container.Image ?? '').toLowerCase();
  const ports = Array.isArray(container.Ports) ? container.Ports : [];

  let score = 0;
  if (container.State === 'running') score += 20;
  if (names.includes('nginx')) score += 50;
  if (image.includes('nginx')) score += 40;
  if (ports.some((port: any) => [80, 443].includes(port.PrivatePort) || [80, 443].includes(port.PublicPort))) {
    score += 30;
  }

  return score;
}

function readMountedConfig(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      const resolved = resolveMountedSymlink(path, target);
      return readFileSync(resolved, 'utf-8');
    }
    if (!stat.isFile()) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return null;
    }
  }
}

function resolveMountedSymlink(path: string, target: string): string {
  if (target.startsWith('/')) {
    if (path.startsWith('/host/root/')) {
      return `/host/root${target}`;
    }
    return target;
  }
  return join(dirname(path), target);
}

function readHostLogDelta(paths: string[], kind: 'access' | 'error'): string[] {
  for (const path of paths) {
    if (!existsSync(path)) continue;

    try {
      const stat = statSync(path);
      const isAccess = kind === 'access';
      const previousInode = isAccess ? hostAccessInode : hostErrorInode;
      let previousOffset = isAccess ? hostAccessOffset : hostErrorOffset;

      if (stat.ino !== previousInode || stat.size < previousOffset) {
        previousOffset = 0;
      }

      const content = readFileSync(path, 'utf-8');
      const delta = content.slice(previousOffset);
      const nextOffset = Buffer.byteLength(content, 'utf-8');

      if (isAccess) {
        hostAccessInode = stat.ino;
        hostAccessOffset = nextOffset;
      } else {
        hostErrorInode = stat.ino;
        hostErrorOffset = nextOffset;
      }

      return delta.split('\n').map((line) => line.trim()).filter(Boolean);
    } catch {
      // Try next candidate.
    }
  }

  return [];
}

function dockerGetJson<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: DOCKER_SOCKET, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Docker API timeout')));
    req.end();
  });
}

function dockerGetBuffer(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: DOCKER_SOCKET, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Docker logs timeout')));
    req.end();
  });
}

function decodeDockerLogStream(payload: Buffer, cursor: string): DockerLogLine[] {
  if (payload.length === 0) return [];

  const lines: DockerLogLine[] = [];
  let offset = 0;

  while (offset + 8 <= payload.length) {
    const frameLength = payload.readUInt32BE(offset + 4);
    const frameStart = offset + 8;
    const frameEnd = frameStart + frameLength;

    if (frameEnd > payload.length) break;

    const message = payload.subarray(frameStart, frameEnd).toString('utf-8');
    collectLines(message, lines, cursor);
    offset = frameEnd;
  }

  if (offset < payload.length) {
    collectLines(payload.subarray(offset).toString('utf-8'), lines, cursor);
  }

  return lines;
}

function collectLines(chunk: string, target: DockerLogLine[], cursor: string) {
  for (const rawLine of chunk.split('\n')) {
    if (!rawLine.trim()) continue;

    const match = rawLine.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
    const timestamp = match?.[1] ?? '';
    const message = match?.[2] ?? rawLine;
    const lineCursor = `${timestamp}\u0000${message}`;

    if (cursor && lineCursor <= cursor) continue;
    target.push({ cursor: lineCursor, message });
  }
}
