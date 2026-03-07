import { readFileSync, readdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function collectInterfaces() {
  const interfaces: Array<{
    name: string; state: string; mac: string; mtu: number;
    addresses: string[]; type: string;
  }> = [];

  try {
    const dirs = readdirSync('/sys/class/net');
    for (const name of dirs) {
      if (name === 'lo') continue;
      try {
        const state = readFileSync(`/sys/class/net/${name}/operstate`, 'utf-8').trim();
        const mac = readFileSync(`/sys/class/net/${name}/address`, 'utf-8').trim();
        const mtu = parseInt(readFileSync(`/sys/class/net/${name}/mtu`, 'utf-8').trim());
        const type = readFileSync(`/sys/class/net/${name}/type`, 'utf-8').trim();
        interfaces.push({ name, state, mac, mtu, addresses: [], type });
      } catch { /* skip */ }
    }
  } catch { /* /sys not available */ }

  return interfaces;
}

export async function collectConnections() {
  try {
    const { stdout } = await execFileAsync('ss', ['-tunp', '--no-header']);
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        protocol: parts[0],
        state: parts[1],
        recvQ: parseInt(parts[2] ?? '0'),
        sendQ: parseInt(parts[3] ?? '0'),
        local: parts[4],
        peer: parts[5],
        process: parts[6],
      };
    });
  } catch {
    return [];
  }
}

export async function collectWireGuard() {
  // Validate interface name: only allow alphanumeric and dash
  const validIface = /^[a-zA-Z0-9-]+$/;

  try {
    const { stdout } = await execFileAsync('wg', ['show', 'all', 'dump']);
    if (!stdout.trim()) return null;

    const lines = stdout.trim().split('\n');
    const interfaces: Record<string, { publicKey: string; listenPort: number; peers: any[] }> = {};

    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length === 4) {
        // Interface line
        const name = parts[0]!;
        if (!validIface.test(name)) continue;
        interfaces[name] = {
          publicKey: parts[1]!,
          listenPort: parseInt(parts[2]!),
          peers: [],
        };
      } else if (parts.length >= 8) {
        // Peer line
        const ifaceName = parts[0]!;
        if (!validIface.test(ifaceName)) continue;
        const iface = interfaces[ifaceName];
        if (iface) {
          iface.peers.push({
            publicKey: parts[1],
            endpoint: parts[3] === '(none)' ? null : parts[3],
            allowedIps: parts[4]?.split(',') ?? [],
            latestHandshake: parseInt(parts[5] ?? '0'),
            transferRx: parseInt(parts[6] ?? '0'),
            transferTx: parseInt(parts[7] ?? '0'),
          });
        }
      }
    }

    return interfaces;
  } catch {
    return null;
  }
}

export function collectArpTable() {
  try {
    const content = readFileSync('/proc/net/arp', 'utf-8');
    const lines = content.trim().split('\n').slice(1);
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        ip: parts[0],
        hwType: parts[1],
        flags: parts[2],
        mac: parts[3],
        device: parts[5],
      };
    }).filter(e => e.mac !== '00:00:00:00:00:00');
  } catch {
    return [];
  }
}
