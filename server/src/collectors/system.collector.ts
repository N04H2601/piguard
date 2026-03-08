import { readFileSync, existsSync, realpathSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { basename } from 'path';

const execFileAsync = promisify(execFile);
const DISK_SECTOR_BYTES = 512;

interface CpuTimes {
  user: number; nice: number; system: number; idle: number;
  iowait: number; irq: number; softirq: number; steal: number;
}

interface DiskCounters {
  reads: number;
  writes: number;
  readSectors: number;
  writeSectors: number;
}

interface DiskTopPath {
  path: string;
  size: number;
  percent: number;
}

let prevCpuTimes: CpuTimes[] = [];
let prevNetStats: Map<string, { rx: number; tx: number; ts: number }> = new Map();
let prevDiskStats: Map<string, { reads: number; writes: number; readSectors: number; writeSectors: number; ts: number }> = new Map();
let cachedDiskTopPaths: DiskTopPath[] = [];
let diskTopPathsCollectedAt = 0;
let diskTopPathsPromise: Promise<DiskTopPath[]> | null = null;

const DISK_TOP_PATHS_REFRESH_MS = 10 * 60 * 1000;

function readProcFile(relativePath: string): string {
  const candidates = [`/host/proc/${relativePath}`, `/proc/${relativePath}`];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf-8');
    } catch {
      // Try next procfs source.
    }
  }
  throw new Error(`Unable to read procfs path: ${relativePath}`);
}

function parseProcStat(): CpuTimes[] {
  const content = readProcFile('stat');
  const cpus: CpuTimes[] = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('cpu') && line[3] !== ' ') {
      const parts = line.split(/\s+/).slice(1).map(Number);
      cpus.push({
        user: parts[0] ?? 0, nice: parts[1] ?? 0, system: parts[2] ?? 0,
        idle: parts[3] ?? 0, iowait: parts[4] ?? 0, irq: parts[5] ?? 0,
        softirq: parts[6] ?? 0, steal: parts[7] ?? 0,
      });
    }
  }
  return cpus;
}

function calcCpuUsage(prev: CpuTimes, curr: CpuTimes): number {
  const prevTotal = Object.values(prev).reduce((a, b) => a + b, 0);
  const currTotal = Object.values(curr).reduce((a, b) => a + b, 0);
  const totalDelta = currTotal - prevTotal;
  const idleDelta = (curr.idle + curr.iowait) - (prev.idle + prev.iowait);
  if (totalDelta === 0) return 0;
  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

function parseDiskStats(): Map<string, DiskCounters> {
  const counters = new Map<string, DiskCounters>();
  try {
    const content = readProcFile('diskstats');
    for (const line of content.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 14) continue;

      const name = parts[2] ?? '';
      if (!name || name.startsWith('loop') || name.startsWith('ram')) continue;

      counters.set(name, {
        reads: parseInt(parts[3] ?? '0', 10),
        readSectors: parseInt(parts[5] ?? '0', 10),
        writes: parseInt(parts[7] ?? '0', 10),
        writeSectors: parseInt(parts[9] ?? '0', 10),
      });
    }
  } catch {
    // /proc/diskstats not available
  }
  return counters;
}

function primeNetworkBaselines() {
  try {
    const content = readProcFile('net/dev');
    const now = Date.now();
    for (const line of content.split('\n').slice(2)) {
      const match = line.match(/^\s*(\w+):\s*(.*)/);
      if (!match) continue;
      const name = match[1] ?? '';
      if (!name || name === 'lo') continue;
      const parts = (match[2] ?? '').trim().split(/\s+/).map(Number);
      prevNetStats.set(name, {
        rx: parts[0] ?? 0,
        tx: parts[8] ?? 0,
        ts: now,
      });
    }
  } catch {
    // ignore missing procfs
  }
}

function primeDiskBaselines() {
  const now = Date.now();
  for (const [name, stats] of parseDiskStats()) {
    prevDiskStats.set(name, { ...stats, ts: now });
  }
}

function resolveDiskDeviceName(device: string, diskStats: Map<string, DiskCounters>): string | null {
  if (!device.startsWith('/dev/')) return null;

  const candidates: string[] = [];
  const pushCandidate = (value: string) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  pushCandidate(basename(device));
  try {
    pushCandidate(basename(realpathSync(device)));
  } catch {
    // Device path may not exist in container namespace.
  }

  for (const current of [...candidates]) {
    if (/^nvme\d+n\d+p\d+$/.test(current)) {
      pushCandidate(current.replace(/p\d+$/, ''));
    } else if (/^(mmcblk\d+)p\d+$/.test(current)) {
      pushCandidate(current.replace(/p\d+$/, ''));
    } else if (/^[a-z]+\d+$/.test(current)) {
      pushCandidate(current.replace(/\d+$/, ''));
    }
  }

  for (const candidate of candidates) {
    if (diskStats.has(candidate)) return candidate;
  }

  return null;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeHostRootPath(value: string): string {
  if (value === '/host/root') return '/';
  if (value.startsWith('/host/root/')) {
    const normalized = value.slice('/host/root'.length);
    return normalized || '/';
  }
  return value;
}

function isTechnicalDiskPath(path: string): boolean {
  return path === '/'
    || path === '/boot'
    || path === '/boot/firmware'
    || path === '/dev'
    || path === '/proc'
    || path === '/sys'
    || path === '/run';
}

function parseDfOutput(stdout: string, hasOutputHeader: boolean) {
  const lines = stdout.trim().split('\n').slice(1);
  return lines
    .map((line) => {
      const parts = line.trim().split(/\s+/);

      if (hasOutputHeader) {
        if (parts.length < 7) return null;
        const device = parts[0] ?? '';
        if (!device.startsWith('/dev/')) return null;
        return {
          device,
          mount: parts[1] ?? '/',
          fstype: parts[2] ?? 'unknown',
          total: parseInt(parts[3] ?? '0', 10),
          used: parseInt(parts[4] ?? '0', 10),
          free: parseInt(parts[5] ?? '0', 10),
          usedPercent: parseFloat((parts[6] ?? '0%').replace('%', '')),
        };
      }

      if (parts.length < 6) return null;
      const device = parts[0] ?? '';
      if (!device.startsWith('/dev/')) return null;
      return {
        device,
        mount: parts[5] ?? '/',
        fstype: 'unknown',
        total: parseInt(parts[1] ?? '0', 10),
        used: parseInt(parts[2] ?? '0', 10),
        free: parseInt(parts[3] ?? '0', 10),
        usedPercent: parseFloat((parts[4] ?? '0%').replace('%', '')),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function collectCpu() {
  const cpus = parseProcStat();
  const usage = prevCpuTimes.length === cpus.length
    ? cpus.map((c, i) => calcCpuUsage(prevCpuTimes[i]!, c))
    : cpus.map(() => 0);
  prevCpuTimes = cpus;

  const loadAvg = readProcFile('loadavg').split(/\s+/).slice(0, 3).map(Number);

  let frequency: number | undefined;
  try {
    const freqStr = readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq', 'utf-8').trim();
    frequency = parseInt(freqStr) / 1000; // kHz -> MHz
  } catch { /* not available */ }

  let governor: string | undefined;
  try {
    governor = readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'utf-8').trim();
  } catch { /* not available */ }

  const overall = cpus.length > 0 && prevCpuTimes.length > 0
    ? usage.reduce((a, b) => a + b, 0) / usage.length
    : 0;

  return {
    overall: Math.round(overall * 100) / 100,
    cores: usage.map(u => Math.round(u * 100) / 100),
    loadAvg,
    frequency,
    governor,
    coreCount: cpus.length,
  };
}

export function collectMemory() {
  const content = readProcFile('meminfo');
  const values: Record<string, number> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) values[match[1]!] = parseInt(match[2]!) * 1024; // kB -> bytes
  }

  const total = values['MemTotal'] ?? 0;
  const free = values['MemFree'] ?? 0;
  const buffers = values['Buffers'] ?? 0;
  const cached = values['Cached'] ?? 0;
  const sReclaimable = values['SReclaimable'] ?? 0;
  const available = values['MemAvailable'] ?? (free + buffers + cached);
  const used = total - available;

  const swapTotal = values['SwapTotal'] ?? 0;
  const swapFree = values['SwapFree'] ?? 0;
  const swapUsed = swapTotal - swapFree;

  return {
    total, used, free, available, buffers, cached: cached + sReclaimable,
    usedPercent: total > 0 ? Math.round((used / total) * 10000) / 100 : 0,
    swap: { total: swapTotal, used: swapUsed, free: swapFree },
  };
}

export async function collectTemperature() {
  let temp: number | null = null;
  let throttled: number | null = null;

  try {
    const { stdout } = await execFileAsync('vcgencmd', ['measure_temp']);
    const match = stdout.match(/temp=([\d.]+)/);
    if (match) temp = parseFloat(match[1]!);
  } catch {
    // Try thermal zone
    try {
      const t = readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf-8').trim();
      temp = parseInt(t) / 1000;
    } catch { /* unavailable */ }
  }

  try {
    const { stdout } = await execFileAsync('vcgencmd', ['get_throttled']);
    const match = stdout.match(/throttled=(0x[\da-fA-F]+)/);
    if (match) throttled = parseInt(match[1]!, 16);
  } catch { /* unavailable */ }

  const flags = throttled !== null ? {
    underVoltage: !!(throttled & 0x1),
    freqCapped: !!(throttled & 0x2),
    throttled: !!(throttled & 0x4),
    softTempLimit: !!(throttled & 0x8),
    underVoltageOccurred: !!(throttled & 0x10000),
    freqCappedOccurred: !!(throttled & 0x20000),
    throttledOccurred: !!(throttled & 0x40000),
    softTempLimitOccurred: !!(throttled & 0x80000),
  } : null;

  return { temp, throttled: flags };
}

export async function collectDiskUsage() {
  try {
    const { stdout } = await execFileAsync('df', ['-B1', '--output=source,target,fstype,size,used,avail,pcent']);
    return parseDfOutput(stdout, true);
  } catch {
    try {
      const { stdout } = await execFileAsync('df', ['-B1']);
      return parseDfOutput(stdout, false);
    } catch {
      return [];
    }
  }
}

export async function collectDisk() {
  const usage = await collectDiskUsage() as Array<{
    device: string;
    mount: string;
    fstype: string;
    total: number;
    used: number;
    free: number;
    usedPercent: number;
  }>;

  const counters = parseDiskStats();
  const now = Date.now();

  return usage.map((entry) => {
    const deviceName = resolveDiskDeviceName(entry.device, counters);
    const current = deviceName ? counters.get(deviceName) : undefined;
    const prev = deviceName ? prevDiskStats.get(deviceName) : undefined;

    let readIops = 0;
    let writeIops = 0;
    let readBps = 0;
    let writeBps = 0;

    if (deviceName && current) {
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        if (dt > 0) {
          readIops = Math.max(0, (current.reads - prev.reads) / dt);
          writeIops = Math.max(0, (current.writes - prev.writes) / dt);
          readBps = Math.max(0, ((current.readSectors - prev.readSectors) * DISK_SECTOR_BYTES) / dt);
          writeBps = Math.max(0, ((current.writeSectors - prev.writeSectors) * DISK_SECTOR_BYTES) / dt);
        }
      }
      prevDiskStats.set(deviceName, { ...current, ts: now });
    }

    return {
      ...entry,
      name: deviceName ?? basename(entry.device),
      readIops: roundMetric(readIops),
      writeIops: roundMetric(writeIops),
      readBps: roundMetric(readBps),
      writeBps: roundMetric(writeBps),
    };
  });
}

export async function collectDiskTopPaths(): Promise<DiskTopPath[]> {
  const now = Date.now();
  if (cachedDiskTopPaths.length > 0 && now - diskTopPathsCollectedAt < DISK_TOP_PATHS_REFRESH_MS) {
    return cachedDiskTopPaths;
  }

  if (!diskTopPathsPromise) {
    diskTopPathsPromise = (async () => {
      try {
        const { stdout } = await execFileAsync('du', ['-x', '-B1', '-d', '1', '/host/root'], {
          maxBuffer: 1024 * 1024 * 8,
        });

        const entries = stdout
          .trim()
          .split('\n')
          .map((line) => {
            const match = line.trim().match(/^(\d+)\s+(.+)$/);
            if (!match) return null;
            return {
              size: parseInt(match[1] ?? '0', 10),
              path: normalizeHostRootPath(match[2] ?? ''),
            };
          })
          .filter((entry): entry is { size: number; path: string } => entry !== null)
          .sort((left, right) => right.size - left.size);

        const rootEntry = entries.find((entry) => entry.path === '/');
        const rootSize = rootEntry?.size ?? 0;
        const useful = entries.filter((entry) => !isTechnicalDiskPath(entry.path));
        const selected = (useful.length > 0 ? useful : entries.filter((entry) => entry.path !== '/')).slice(0, 3);

        cachedDiskTopPaths = selected.map((entry) => ({
          path: entry.path,
          size: entry.size,
          percent: rootSize > 0 ? roundMetric((entry.size / rootSize) * 100) : 0,
        }));
        diskTopPathsCollectedAt = Date.now();
      } catch {
        // Keep the existing cache when the scan fails.
      } finally {
        diskTopPathsPromise = null;
      }

      return cachedDiskTopPaths;
    })();
  }

  return cachedDiskTopPaths;
}

export function collectNetwork() {
  const content = readProcFile('net/dev');
  const interfaces: Array<{
    name: string; rxBytes: number; txBytes: number;
    rxRate: number; txRate: number;
    rxPackets: number; txPackets: number;
  }> = [];

  const now = Date.now();
  for (const line of content.split('\n').slice(2)) {
    const match = line.match(/^\s*(\w+):\s*(.*)/);
    if (!match) continue;
    const name = match[1]!;
    if (name === 'lo') continue;
    const parts = match[2]!.trim().split(/\s+/).map(Number);
    const rxBytes = parts[0] ?? 0;
    const txBytes = parts[8] ?? 0;
    const rxPackets = parts[1] ?? 0;
    const txPackets = parts[9] ?? 0;

    const prev = prevNetStats.get(name);
    let rxRate = 0, txRate = 0;
    if (prev) {
      const dt = (now - prev.ts) / 1000;
      if (dt > 0) {
        rxRate = Math.max(0, (rxBytes - prev.rx) / dt);
        txRate = Math.max(0, (txBytes - prev.tx) / dt);
      }
    }
    prevNetStats.set(name, { rx: rxBytes, tx: txBytes, ts: now });

    interfaces.push({ name, rxBytes, txBytes, rxRate, txRate, rxPackets, txPackets });
  }

  return interfaces;
}

export function collectUptime() {
  const content = readProcFile('uptime').trim().split(/\s+/);
  return {
    seconds: parseFloat(content[0] ?? '0'),
    idle: parseFloat(content[1] ?? '0'),
  };
}

export async function collectProcesses() {
  try {
    const { stdout } = await execFileAsync('ps', ['aux', '--sort=-pcpu'], { maxBuffer: 1024 * 1024 });
    const lines = stdout.trim().split('\n');
    const header = lines[0];
    return lines.slice(1, 16).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        user: parts[0],
        pid: parseInt(parts[1] ?? '0'),
        cpu: parseFloat(parts[2] ?? '0'),
        mem: parseFloat(parts[3] ?? '0'),
        vsz: parseInt(parts[4] ?? '0'),
        rss: parseInt(parts[5] ?? '0'),
        command: parts.slice(10).join(' '),
      };
    });
  } catch {
    return [];
  }
}

export async function collectAll() {
  const [temp, disk, diskTopPaths, processes] = await Promise.all([
    collectTemperature(),
    collectDisk(),
    collectDiskTopPaths(),
    collectProcesses(),
  ]);

  return {
    cpu: collectCpu(),
    memory: collectMemory(),
    temperature: temp,
    disk,
    diskTopPaths,
    network: collectNetwork(),
    uptime: collectUptime(),
    processes,
    timestamp: Date.now(),
  };
}

prevCpuTimes = parseProcStat();
primeNetworkBaselines();
primeDiskBaselines();
