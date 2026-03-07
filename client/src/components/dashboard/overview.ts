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

    .gauge-row,
    .grid {
      display: grid;
      gap: 18px;
      align-items: stretch;
    }

    .gauge-row {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    }

    .grid {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    }

    .gauge-row > *,
    .grid > * {
      min-width: 0;
    }

    .grid > .wide {
      grid-column: span 2;
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
      .grid > .wide {
        grid-column: auto;
      }
    }

    @media (max-width: 760px) {
      :host {
        padding: 14px;
      }

      .net-interface {
        align-items: flex-start;
        flex-direction: column;
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

    const { cpu, memory, temperature, disk, network, uptime, processes } = this.data;

    return html`
      <div class="page-shell">
        <div class="page-title">
          <span class="dot"></span>
          System Overview
        </div>

        <div class="gauge-row">
        <pg-card cardTitle="CPU" icon="■">
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

        <pg-card cardTitle="Memory" icon="▦">
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

        <pg-card
          cardTitle="Temperature"
          icon="♨"
          .status=${(temperature?.temp ?? 0) >= 80 ? 'danger' : (temperature?.temp ?? 0) >= 65 ? 'warning' : 'normal'}
        >
          <div class="gauge-center">
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
        </pg-card>

        <pg-card cardTitle="Uptime" icon="⏱">
          <div class="gauge-center">
            <span class="stat-value">${formatUptime(uptime?.seconds ?? 0)}</span>
            <span class="stat-label">System Uptime</span>
          </div>
        </pg-card>
        </div>

        <div class="grid">
        <pg-card cardTitle="Disk Usage" icon="◉">
          ${disk?.length ? html`
            <div class="disk-list">
              ${disk.map((entry: any) => html`
                <div class="disk-block">
                  <div class="disk-info">
                    <span>${entry.mount}</span>
                    <span>${formatBytes(entry.used)} / ${formatBytes(entry.total)} (${entry.usedPercent}%)</span>
                  </div>
                  <div class="disk-meta">
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

        <pg-card cardTitle="Network" icon="◈">
          ${network?.length ? html`
            <div class="history-block">
              <div class="history-label">Aggregate bandwidth</div>
              <pg-sparkline .values=${this.networkHistory} color="var(--success)" fill="color-mix(in srgb, var(--success) 18%, transparent)"></pg-sparkline>
            </div>
            ${(network ?? []).map((iface: any) => html`
              <div class="net-interface">
                <span class="net-name">${iface.name}</span>
                <div class="net-rates">
                  <span class="net-rx">↓ ${formatRate(iface.rxRate)}</span>
                  <span class="net-tx">↑ ${formatRate(iface.txRate)}</span>
                </div>
              </div>
            `)}
          ` : html`<pg-empty-state title="No interfaces" detail="The collector did not report any active network interfaces."></pg-empty-state>`}
        </pg-card>

        <pg-card class="wide" cardTitle="Top Processes" icon="☰">
          ${processes?.length ? html`
            <div class="process-wrap">
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
          ` : html`<pg-empty-state title="No process list" detail="The process collector is unavailable in this environment."></pg-empty-state>`}
        </pg-card>
        </div>
      </div>
    `;
  }
}
