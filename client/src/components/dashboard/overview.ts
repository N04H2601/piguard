import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import '../shared/card.js';
import '../shared/gauge.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';
import '../shared/sparkline.js';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
}

function normalizeDiskMount(mount: string): string {
  if (!mount) return '/';
  if (mount === '/host/root') return '/';
  if (mount.startsWith('/host/root/')) {
    const normalized = mount.slice('/host/root'.length);
    return normalized || '/';
  }
  return mount;
}

function isBootMount(mount: string): boolean {
  return mount === '/boot' || mount === '/boot/firmware';
}

function prepareDiskEntries(entries: any[]): any[] {
  const normalized = entries
    .map((entry) => ({
      ...entry,
      logicalMount: normalizeDiskMount(entry.mount),
    }))
    .sort((left, right) => {
      if (left.logicalMount === '/') return -1;
      if (right.logicalMount === '/') return 1;
      return left.logicalMount.localeCompare(right.logicalMount);
    });

  const useful = normalized.filter((entry) => !isBootMount(entry.logicalMount));
  return useful.length > 0 ? useful : normalized;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

@customElement('pg-overview')
export class Overview extends LitElement {
  @property({ type: Object }) data: any = null;
  @state() private loadingHistory = true;
  @state() private cpuHistory: number[] = [];
  @state() private memoryHistory: number[] = [];
  @state() private networkHistory: number[] = [];

  static styles = css`
    :host {
      display: block;
      padding: clamp(16px, 2vw, 28px);
      overflow-y: auto;
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
    }

    .page-title {
      font-family: var(--font-mono);
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .page-shell {
      max-width: 1580px;
      margin: 0 auto;
      display: grid;
      gap: 24px;
    }

    .page-title .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 8px var(--success);
    }

    .dashboard-columns {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 20px;
      align-items: start;
    }

    .dashboard-column {
      display: flex;
      flex-direction: column;
      gap: 20px;
      align-items: stretch;
      min-width: 0;
    }

    .dashboard-column > * {
      min-width: 0;
      flex: 0 0 auto;
      height: auto;
    }

    pg-card.metric-card,
    pg-card.data-card {
      display: block;
      height: auto;
      min-height: 320px;
    }

    pg-card.metric-card {
      min-height: 320px;
    }

    pg-card.data-card {
      min-height: 320px;
    }

    pg-gauge {
      --gauge-max-size: 124px;
    }

    .gauge-center {
      display: grid;
      gap: 14px;
      justify-items: center;
      padding: 8px 0 2px;
    }

    .stat-value {
      font-family: var(--font-mono);
      font-size: 30px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1;
    }

    .stat-label,
    .stat-sub {
      font-family: var(--font-mono);
      text-align: center;
    }

    .stat-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .stat-sub {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .history-block {
      width: 100%;
      display: grid;
      gap: 8px;
    }

    .history-label {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.14em;
    }

    .core-bars {
      display: flex;
      gap: 4px;
      align-items: flex-end;
      height: 48px;
      width: 100%;
      margin-top: 6px;
    }

    .core-bar {
      flex: 1;
      min-width: 8px;
      border-radius: 999px 999px 3px 3px;
      transition: height 0.5s ease, background 0.3s;
    }

    .stat-tiles {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      align-content: start;
    }

    .stat-tile {
      display: grid;
      align-content: start;
      gap: 10px;
      min-height: 130px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: color-mix(in srgb, var(--bg-secondary) 58%, transparent);
    }

    .temp-value {
      font-family: var(--font-mono);
      font-size: 36px;
      font-weight: 700;
      line-height: 1;
    }

    .throttle-flags {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .flag {
      font-family: var(--font-mono);
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--success-dim);
      color: var(--success);
    }

    .flag.active {
      background: var(--danger-dim);
      color: var(--danger);
    }

    .card-scroll {
      overflow: auto;
      min-height: 0;
      max-height: 220px;
      padding-right: 4px;
    }

    .disk-scroll {
      max-height: 240px;
    }

    .network-stack,
    .process-stack {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 14px;
      min-height: 0;
    }

    .network-scroll {
      max-height: 190px;
    }

    .net-interface {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }

    .net-interface:last-child { border-bottom: none; }

    .net-name {
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--accent);
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    .net-rates {
      display: flex;
      gap: 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .net-rx { color: var(--success); }
    .net-tx { color: var(--info); }

    .process-wrap {
      overflow: auto;
    }

    .process-table {
      min-width: 580px;
    }

    .process-row {
      display: grid;
      grid-template-columns: 72px 60px 60px minmax(220px, 1fr);
      gap: 8px;
      padding: 6px 0;
      font-family: var(--font-mono);
      font-size: 11px;
      border-bottom: 1px solid var(--border);
    }

    .process-row:last-child { border-bottom: none; }
    .process-header { color: var(--text-muted); font-weight: 600; }
    .process-cmd { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .disk-list {
      display: grid;
      gap: 12px;
    }

    .disk-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .disk-summary-item {
      display: grid;
      gap: 4px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: color-mix(in srgb, var(--bg-secondary) 58%, transparent);
    }

    .disk-summary-label {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    .disk-summary-value {
      font-family: var(--font-mono);
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .disk-block {
      display: grid;
      gap: 6px;
    }

    .disk-info {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      flex-wrap: wrap;
    }

    .disk-meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
    }

    .disk-info span,
    .disk-meta span {
      overflow-wrap: anywhere;
    }

    .disk-bar {
      height: 7px;
      background: var(--border);
      border-radius: 999px;
      overflow: hidden;
    }

    .disk-bar-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 0.5s ease;
    }

    @media (max-width: 1280px) {
      .dashboard-columns {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      :host {
        padding: 14px;
      }

      .dashboard-columns {
        grid-template-columns: 1fr;
      }

      .net-interface {
        align-items: flex-start;
        flex-direction: column;
      }

      .stat-tiles {
        grid-template-columns: 1fr;
      }

      .disk-summary {
        grid-template-columns: 1fr;
      }

      pg-gauge {
        --gauge-max-size: 108px;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.fetchHistory();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('data') && this.data) {
      this.cpuHistory = this.appendSample(this.cpuHistory, this.data.cpu?.overall ?? 0);
      this.memoryHistory = this.appendSample(this.memoryHistory, this.data.memory?.usedPercent ?? 0);
      const totalBandwidth = (this.data.network ?? []).reduce((sum: number, iface: any) => sum + iface.rxRate + iface.txRate, 0);
      this.networkHistory = this.appendSample(this.networkHistory, totalBandwidth);
    }
  }

  private appendSample(target: number[], value: number): number[] {
    const next = [...target, value];
    return next.slice(-30);
  }

  private async fetchHistory() {
    this.loadingHistory = true;
    try {
      const [cpu, memory] = await Promise.all([
        apiFetch<Array<{ value: number }>>(`/api/v1/stats/history?metric=cpu.overall&from=${Date.now() - 3600000}&limit=120`),
        apiFetch<Array<{ value: number }>>(`/api/v1/stats/history?metric=memory.usedPercent&from=${Date.now() - 3600000}&limit=120`),
      ]);
      this.cpuHistory = cpu.map((entry) => entry.value).reverse();
      this.memoryHistory = memory.map((entry) => entry.value).reverse();
    } catch {
      // Leave inline charts empty if history is unavailable.
    } finally {
      this.loadingHistory = false;
    }
  }

  private getTempColor(temp: number): string {
    if (temp >= 80) return 'var(--danger)';
    if (temp >= 65) return 'var(--warning)';
    return 'var(--accent)';
  }

  private getCoreColor(usage: number): string {
    if (usage >= 90) return 'var(--danger)';
    if (usage >= 70) return 'var(--warning)';
    return 'var(--accent)';
  }

  private getDiskColor(pct: number): string {
    if (pct >= 90) return 'var(--danger)';
    if (pct >= 75) return 'var(--warning)';
    return 'var(--accent)';
  }

  render() {
    if (!this.data && this.loadingHistory) {
      return html`<pg-loading-state label="Bootstrapping telemetry"></pg-loading-state>`;
    }

    if (!this.data) {
      return html`<pg-empty-state title="No live data" detail="The dashboard is connected, but the first telemetry frame has not arrived yet."></pg-empty-state>`;
    }

    const { cpu, memory, temperature, disk, diskTopPaths, network, uptime, processes } = this.data;
    const diskEntries = prepareDiskEntries(disk ?? []);
    const primaryDisk = diskEntries.find((entry: any) => entry.logicalMount === '/') ?? diskEntries[0];
    const additionalDisks = diskEntries.filter((entry: any) => entry.logicalMount !== '/');

    return html`
      <div class="page-shell">
        <div class="page-title">
          <span class="dot"></span>
          System Overview
        </div>

        <div class="dashboard-columns">
          <div class="dashboard-column">
            <pg-card class="metric-card" cardTitle="CPU" icon="■">
              <div class="gauge-center">
                <pg-gauge .value=${cpu?.overall ?? 0} label="CPU Usage"></pg-gauge>
                <div class="stat-sub">Load: ${cpu?.loadAvg?.map((l: number) => l.toFixed(2)).join(' / ') ?? '-'}</div>
                ${cpu?.frequency ? html`<div class="stat-sub">${cpu.frequency.toFixed(0)} MHz${cpu.governor ? ` (${cpu.governor})` : ''}</div>` : ''}
                <div class="history-block">
                  <div class="history-label">Last hour</div>
                  <pg-sparkline .values=${this.cpuHistory}></pg-sparkline>
                </div>
                <div class="core-bars">
                  ${(cpu?.cores ?? []).map((usage: number) => html`<div class="core-bar" style="height: ${Math.max(usage, 4)}%; background: ${this.getCoreColor(usage)}"></div>`)}
                </div>
              </div>
            </pg-card>

            <pg-card class="data-card" cardTitle="Disk Usage" icon="◉">
              ${diskEntries.length ? html`
                <div class="disk-list card-scroll disk-scroll">
                  ${primaryDisk ? html`
                    <div class="disk-summary">
                      <div class="disk-summary-item">
                        <span class="disk-summary-label">Total</span>
                        <span class="disk-summary-value">${formatBytes(primaryDisk.total)}</span>
                      </div>
                      <div class="disk-summary-item">
                        <span class="disk-summary-label">Used</span>
                        <span class="disk-summary-value">${formatBytes(primaryDisk.used)}</span>
                      </div>
                      <div class="disk-summary-item">
                        <span class="disk-summary-label">Free</span>
                        <span class="disk-summary-value">${formatBytes(primaryDisk.free)}</span>
                      </div>
                    </div>
                  ` : ''}
                  ${diskTopPaths?.length ? html`
                    <div class="disk-block">
                      <div class="disk-info">
                        <span>Largest paths</span>
                        <span>Top 3 on root</span>
                      </div>
                      ${diskTopPaths.map((entry: any) => html`
                        <div class="disk-meta">
                          <span>${entry.path}</span>
                          <span>${formatBytes(entry.size)}</span>
                          <span>${formatPercent(entry.percent)} of /</span>
                        </div>
                      `)}
                    </div>
                  ` : ''}
                  ${additionalDisks.map((entry: any) => html`
                    <div class="disk-block">
                      <div class="disk-info">
                        <span>${entry.logicalMount}</span>
                        <span>${formatBytes(entry.used)} / ${formatBytes(entry.total)} (${entry.usedPercent}%)</span>
                      </div>
                      <div class="disk-meta">
                        <span>Free ${formatBytes(entry.free)}</span>
                        <span>Read ${entry.readIops.toFixed(1)} IOPS</span>
                        <span>Write ${entry.writeIops.toFixed(1)} IOPS</span>
                        <span>${formatRate(entry.readBps)} in</span>
                        <span>${formatRate(entry.writeBps)} out</span>
                      </div>
                      <div class="disk-bar">
                        <div class="disk-bar-fill" style="width: ${entry.usedPercent}%; background: ${this.getDiskColor(entry.usedPercent)}"></div>
                      </div>
                    </div>
                  `)}
                </div>
              ` : html`<pg-empty-state title="No disks" detail="No mounted block devices were detected."></pg-empty-state>`}
            </pg-card>
          </div>

          <div class="dashboard-column">
            <pg-card class="metric-card" cardTitle="Memory" icon="▦">
              <div class="gauge-center">
                <pg-gauge .value=${memory?.usedPercent ?? 0} label="RAM Usage"></pg-gauge>
                <div class="stat-sub">${formatBytes(memory?.used ?? 0)} / ${formatBytes(memory?.total ?? 0)}</div>
                <div class="stat-sub">Cache: ${formatBytes(memory?.cached ?? 0)} | Buffers: ${formatBytes(memory?.buffers ?? 0)}</div>
                ${memory?.swap?.total > 0 ? html`<div class="stat-sub">Swap: ${formatBytes(memory.swap.used)} / ${formatBytes(memory.swap.total)}</div>` : ''}
                <div class="history-block">
                  <div class="history-label">Last hour</div>
                  <pg-sparkline .values=${this.memoryHistory} color="var(--info)" fill="color-mix(in srgb, var(--info) 18%, transparent)"></pg-sparkline>
                </div>
              </div>
            </pg-card>

            <pg-card class="data-card" cardTitle="Network" icon="◈">
              ${network?.length ? html`
                <div class="network-stack">
                  <div class="history-block">
                    <div class="history-label">Aggregate bandwidth</div>
                    <pg-sparkline .values=${this.networkHistory} color="var(--success)" fill="color-mix(in srgb, var(--success) 18%, transparent)"></pg-sparkline>
                  </div>
                  <div class="card-scroll network-scroll">
                    ${(network ?? []).map((iface: any) => html`
                      <div class="net-interface">
                        <span class="net-name">${iface.name}</span>
                        <div class="net-rates">
                          <span class="net-rx">↓ ${formatRate(iface.rxRate)}</span>
                          <span class="net-tx">↑ ${formatRate(iface.txRate)}</span>
                        </div>
                      </div>
                    `)}
                  </div>
                </div>
              ` : html`<pg-empty-state title="No interfaces" detail="The collector did not report any active network interfaces."></pg-empty-state>`}
            </pg-card>
          </div>

          <div class="dashboard-column">
            <pg-card
              class="metric-card"
              cardTitle="Temp / Uptime"
              icon="♨"
              .status=${(temperature?.temp ?? 0) >= 80 ? 'danger' : (temperature?.temp ?? 0) >= 65 ? 'warning' : 'normal'}
            >
              <div class="stat-tiles">
                <div class="stat-tile">
                  ${temperature?.temp !== null ? html`<span class="temp-value" style="color: ${this.getTempColor(temperature.temp)}">${temperature.temp.toFixed(1)}°C</span>` : html`<span class="temp-value" style="color: var(--text-muted)">N/A</span>`}
                  <span class="stat-label">SoC Temperature</span>
                  ${temperature?.throttled ? html`
                    <div class="throttle-flags">
                      <span class="flag ${temperature.throttled.underVoltage ? 'active' : ''}">UV</span>
                      <span class="flag ${temperature.throttled.freqCapped ? 'active' : ''}">FC</span>
                      <span class="flag ${temperature.throttled.throttled ? 'active' : ''}">TH</span>
                      <span class="flag ${temperature.throttled.softTempLimit ? 'active' : ''}">ST</span>
                    </div>
                  ` : ''}
                </div>
                <div class="stat-tile">
                  <span class="stat-value">${formatUptime(uptime?.seconds ?? 0)}</span>
                  <span class="stat-label">System Uptime</span>
                  <span class="stat-sub">${uptime?.bootTime ? new Date(uptime.bootTime).toLocaleString() : 'Boot time unavailable'}</span>
                </div>
              </div>
            </pg-card>

            <pg-card class="data-card" cardTitle="Top Processes" icon="☰">
              ${processes?.length ? html`
                <div class="process-stack">
                  <div class="history-label">Highest CPU consumers right now</div>
                  <div class="process-wrap card-scroll">
                    <div class="process-table">
                      <div class="process-row process-header"><span>PID</span><span>CPU%</span><span>MEM%</span><span>Command</span></div>
                      ${(processes ?? []).slice(0, 10).map((processEntry: any) => html`
                        <div class="process-row">
                          <span>${processEntry.pid}</span>
                          <span style="color: ${this.getCoreColor(processEntry.cpu)}">${processEntry.cpu.toFixed(1)}</span>
                          <span>${processEntry.mem.toFixed(1)}</span>
                          <span class="process-cmd" title="${processEntry.command}">${processEntry.command}</span>
                        </div>
                      `)}
                    </div>
                  </div>
                </div>
              ` : html`<pg-empty-state title="No process list" detail="The process collector is unavailable in this environment."></pg-empty-state>`}
            </pg-card>
          </div>
        </div>
      </div>
    `;
  }
}
