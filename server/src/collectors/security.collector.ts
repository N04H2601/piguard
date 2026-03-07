import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let lastAuthLogPos = 0;
let lastAuthLogInode = 0;

type CheckStatus = 'pass' | 'fail' | 'unknown';

type SshOptions = {
  permitRootLogin: string;
  passwordAuthentication: string;
};

function readFirstReadable(paths: string[]): string | null {
  for (const path of paths) {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      // Try next path
    }
  }
  return null;
}

function hasAnyFile(paths: string[]): boolean {
  return paths.some((path) => existsSync(path));
}

function countLetsEncryptCertificates(baseDir: string): number {
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(join(baseDir, entry.name, 'fullchain.pem')))
      .length;
  } catch {
    return 0;
  }
}

function loadSshConfig(paths: string[]): { content: string | null; source: string | null } {
  for (const path of paths) {
    try {
      const main = readFileSync(path, 'utf-8');
      const includeDir = join(dirname(path), 'sshd_config.d');
      const parts = [main];

      try {
        const dropins = readdirSync(includeDir)
          .filter((file) => file.endsWith('.conf'))
          .sort();
        for (const file of dropins) {
          parts.push(`\n# ${basename(file)}\n${readFileSync(join(includeDir, file), 'utf-8')}`);
        }
      } catch {
        // No drop-ins available.
      }

      return { content: parts.join('\n'), source: path };
    } catch {
      // Try next config path.
    }
  }

  return { content: null, source: null };
}

function parseSshOptions(content: string): SshOptions {
  const options: Record<string, string> = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(\S+)\s+(.*)$/);
    if (!match) continue;

    options[match[1]!.toLowerCase()] = match[2]!.trim().toLowerCase();
  }

  return {
    // OpenSSH default when omitted.
    permitRootLogin: options.permitrootlogin ?? 'prohibit-password',
    passwordAuthentication: options.passwordauthentication ?? 'yes',
  };
}

export function parseAuthLog(path = '/var/log/auth.log'): Array<{
  timestamp: string; type: string; ip: string | null; user: string | null; details: string;
}> {
  const events: Array<{ timestamp: string; type: string; ip: string | null; user: string | null; details: string }> = [];
  const candidates = [path, '/host/root/var/log/auth.log'];

  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (stat.ino !== lastAuthLogInode) {
        lastAuthLogPos = 0;
        lastAuthLogInode = stat.ino;
      }

      const content = readFileSync(candidate, 'utf-8');
      const lines = content.split('\n').slice(-500);

      for (const line of lines) {
        let match = line.match(/Failed password for (?:invalid user )?(\S+) from ([\d.]+)/);
        if (match) {
          events.push({ timestamp: line.substring(0, 15), type: 'ssh_failed', ip: match[2]!, user: match[1]!, details: line });
          continue;
        }

        match = line.match(/Accepted (?:password|publickey) for (\S+) from ([\d.]+)/);
        if (match) {
          events.push({ timestamp: line.substring(0, 15), type: 'ssh_success', ip: match[2]!, user: match[1]!, details: line });
          continue;
        }

        match = line.match(/Invalid user (\S+) from ([\d.]+)/);
        if (match) {
          events.push({ timestamp: line.substring(0, 15), type: 'ssh_invalid_user', ip: match[2]!, user: match[1]!, details: line });
          continue;
        }

        match = line.match(/sudo:\s+(\S+)\s.*COMMAND=(.*)/);
        if (match) {
          events.push({ timestamp: line.substring(0, 15), type: 'sudo', ip: null, user: match[1]!, details: match[2]! });
        }
      }
      break;
    } catch {
      // Try next auth.log candidate.
    }
  }

  return events;
}

export async function collectFail2ban() {
  const jails: Array<{ name: string; currentlyBanned: number; totalBanned: number; bannedIps: string[] }> = [];

  try {
    const { stdout } = await execFileAsync('fail2ban-client', ['status']);
    const jailMatch = stdout.match(/Jail list:\s+(.*)/);
    if (!jailMatch) return jails;

    const jailNames = jailMatch[1]!.split(',').map((j) => j.trim()).filter(Boolean);

    for (const name of jailNames) {
      try {
        const { stdout: jailStatus } = await execFileAsync('fail2ban-client', ['status', name]);
        const currentMatch = jailStatus.match(/Currently banned:\s+(\d+)/);
        const totalMatch = jailStatus.match(/Total banned:\s+(\d+)/);
        const ipsMatch = jailStatus.match(/Banned IP list:\s+(.*)/);

        jails.push({
          name,
          currentlyBanned: parseInt(currentMatch?.[1] ?? '0'),
          totalBanned: parseInt(totalMatch?.[1] ?? '0'),
          bannedIps: ipsMatch?.[1]?.split(/\s+/).filter(Boolean) ?? [],
        });
      } catch {
        // jail query failed
      }
    }
  } catch {
    const fallback = readFirstReadable(['/var/log/fail2ban.log', '/host/root/var/log/fail2ban.log']);
    if (!fallback) return jails;

    const byJail = new Map<string, Set<string>>();
    const totals = new Map<string, number>();

    for (const line of fallback.split('\n').slice(-500)) {
      const match = line.match(/\[(.+?)\].*(Ban|Unban)\s+([\d.]+)/);
      if (!match) continue;

      const jail = match[1]!.trim();
      const action = match[2]!;
      const ip = match[3]!;

      if (!byJail.has(jail)) byJail.set(jail, new Set());
      if (!totals.has(jail)) totals.set(jail, 0);

      if (action === 'Ban') {
        byJail.get(jail)!.add(ip);
        totals.set(jail, (totals.get(jail) ?? 0) + 1);
      } else {
        byJail.get(jail)!.delete(ip);
      }
    }

    for (const [name, ips] of byJail) {
      jails.push({
        name,
        currentlyBanned: ips.size,
        totalBanned: totals.get(name) ?? ips.size,
        bannedIps: [...ips],
      });
    }
  }

  return jails;
}

export async function collectSecurityScore() {
  const checks: Array<{ name: string; passed: boolean; status: CheckStatus; weight: number; details?: string }> = [];
  const addCheck = (name: string, weight: number, status: CheckStatus, details?: string) => {
    checks.push({ name, weight, status, passed: status === 'pass', details });
  };

  try {
    const sshConfig = loadSshConfig(['/etc/ssh/sshd_config', '/host/root/etc/ssh/sshd_config']);
    if (!sshConfig.content) {
      addCheck('SSH config readable', 5, 'unknown', 'sshd_config is not mounted inside the container');
    } else {
      const ssh = parseSshOptions(sshConfig.content);
      const rootPasswordBlocked = ssh.permitRootLogin === 'no'
        || ['prohibit-password', 'without-password', 'forced-commands-only'].includes(ssh.permitRootLogin)
        || ssh.passwordAuthentication === 'no';

      addCheck(
        'SSH root password login blocked',
        15,
        rootPasswordBlocked ? 'pass' : 'fail',
        `PermitRootLogin=${ssh.permitRootLogin}; PasswordAuthentication=${ssh.passwordAuthentication}`
      );

      const passwordAuthDisabled = ssh.passwordAuthentication === 'no';
      addCheck(
        'SSH password auth disabled',
        10,
        passwordAuthDisabled ? 'pass' : 'fail',
        `PasswordAuthentication=${ssh.passwordAuthentication}`
      );
    }
  } catch {
    addCheck('SSH config readable', 5, 'unknown', 'sshd_config could not be inspected');
  }

  const fail2banJails = await collectFail2ban();
  if (fail2banJails.length > 0) {
    addCheck('fail2ban active', 15, 'pass', `${fail2banJails.length} jail(s) visible`);
  } else if (hasAnyFile(['/var/log/fail2ban.log', '/host/root/var/log/fail2ban.log', '/host/root/etc/fail2ban'])) {
    addCheck('fail2ban active', 15, 'unknown', 'fail2ban data is present but the control socket is unavailable');
  } else {
    addCheck('fail2ban active', 15, 'unknown', 'fail2ban is not mounted or not installed');
  }

  try {
    const { stdout } = await execFileAsync('ufw', ['status']);
    const active = stdout.includes('Status: active');
    addCheck('Firewall active', 15, active ? 'pass' : 'fail');
  } catch {
    try {
      await execFileAsync('iptables', ['-L', '-n']);
      addCheck('iptables configured', 10, 'pass');
    } catch {
      const ufwConfig = readFirstReadable(['/host/root/etc/ufw/ufw.conf']);
      const iptablesTables = readFirstReadable(['/proc/net/ip_tables_names', '/host/root/proc/net/ip_tables_names']);
      if (ufwConfig) {
        addCheck('Firewall active', 15, /ENABLED=yes/i.test(ufwConfig) ? 'pass' : 'fail');
      } else if (iptablesTables && iptablesTables.trim().length > 0) {
        addCheck('iptables configured', 10, 'pass');
      } else {
        addCheck('Firewall configured', 15, 'unknown', 'No firewall tooling is available inside the container');
      }
    }
  }

  try {
    const { stdout } = await execFileAsync('wg', ['show', 'all', 'dump']);
    addCheck('WireGuard active', 10, stdout.trim().length > 0 ? 'pass' : 'unknown');
  } catch {
    const wireguardDirs = ['/etc/wireguard', '/host/root/etc/wireguard'];
    const hasConfig = wireguardDirs.some((dir) => {
      try {
        return readdirSync(dir).some((file) => file.endsWith('.conf'));
      } catch {
        return false;
      }
    });
    addCheck('WireGuard active', 10, 'unknown', hasConfig ? 'Configuration present but runtime state is unavailable' : 'WireGuard is not mounted or configured');
  }

  const letsEncryptLiveDir = '/host/root/etc/letsencrypt/live';
  if (!existsSync(letsEncryptLiveDir)) {
    addCheck('SSL certificates', 15, 'unknown', 'Let’s Encrypt directory is not mounted');
  } else {
    const certificateCount = countLetsEncryptCertificates(letsEncryptLiveDir);
    addCheck(
      'SSL certificates present',
      15,
      certificateCount > 0 ? 'pass' : 'fail',
      certificateCount > 0 ? `${certificateCount} certificate set(s) detected` : 'No certificate set found under /etc/letsencrypt/live'
    );
  }

  const autoUpgrades = readFirstReadable([
    '/host/root/etc/apt/apt.conf.d/20auto-upgrades',
    '/host/root/etc/apt/apt.conf.d/10periodic',
  ]);
  if (autoUpgrades) {
    addCheck('Auto-updates enabled', 10, /Unattended-Upgrade\s+"1"/.test(autoUpgrades) || /Update-Package-Lists\s+"1"/.test(autoUpgrades) ? 'pass' : 'fail');
  } else {
    addCheck('Auto-updates enabled', 10, 'unknown', 'APT auto-upgrades config is not available');
  }

  const scorable = checks.filter((check) => check.status !== 'unknown');
  const totalWeight = scorable.reduce((sum, check) => sum + check.weight, 0);
  const passedWeight = scorable.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;

  return { score, checks };
}
