import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

@customElement('n04h-docker-panel')
export class DockerPanel extends LitElement {
  @state() private containers: any[] = [];
  @state() private loading = true;
  @state() private error = '';
  @state() private selectedLogs: string | null = null;
  @state() private logs = '';

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host { display: block; padding: clamp(16px, 2vw, 28px); overflow-y: auto; height: 100%; min-height: 0; box-sizing: border-box; }
    .page-title { font-family: var(--font-mono); font-size: 18px; font-weight: 600; margin-bottom: 24px; }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .summary-item {
      padding: 14px 18px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
    }

    .summary-value { font-size: 24px; font-weight: 700; }
    .summary-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }

    .containers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }

    .container-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px;
      transition: border-color 0.2s, transform 0.2s;
      min-height: 210px;
      display: grid;
      gap: 10px;
    }

    .container-card:hover {
      border-color: var(--border-active);
      transform: translateY(-2px);
    }

    .container-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .container-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .container-status.running { background: var(--success); box-shadow: 0 0 6px var(--success); }
    .container-status.exited { background: var(--danger); }
    .container-status.paused { background: var(--warning); }

    .container-name { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary); flex: 1; }
    .container-image { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .container-project {
      font-size: 10px;
      padding: 2px 6px;
      background: var(--accent-dim);
      color: var(--accent);
      border-radius: 999px;
      font-family: var(--font-mono);
    }

    .container-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: auto;
    }

    .container-stat { font-family: var(--font-mono); font-size: 11px; }
    .container-stat-label { color: var(--text-muted); }
    .container-stat-value { color: var(--text-primary); font-weight: 500; }

    .container-status-text { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }

    .logs-btn {
      margin-top: auto;
      width: fit-content;
      padding: 6px 12px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .logs-btn:hover { border-color: var(--accent); color: var(--accent); }

    .logs-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .logs-content {
      width: 100%;
      max-width: 980px;
      max-height: 82vh;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .logs-title { font-family: var(--font-mono); font-size: 13px; font-weight: 600; }
    .logs-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; }

    .logs-body {
      flex: 1;
      overflow: auto;
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 11px;
      line-height: 1.6;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
    }

    .error {
      margin-bottom: 16px;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      background: var(--danger-dim);
      color: var(--danger);
      font-family: var(--font-mono);
      font-size: 12px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.fetchContainers();
    this.refreshInterval = setInterval(() => void this.fetchContainers(), 5000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  private async fetchContainers() {
    this.loading = this.containers.length === 0;
    this.error = '';
    try {
      this.containers = await apiFetch<any[]>('/api/v1/docker/stats');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load Docker stats';
    } finally {
      this.loading = false;
    }
  }

  private async showLogs(id: string) {
    this.selectedLogs = id;
    this.logs = 'Loading logs...';
    try {
      const data = await apiFetch<{ logs: string }>(`/api/v1/docker/${id}/logs?tail=200`);
      this.logs = data.logs || 'No logs returned';
    } catch (err) {
      this.logs = err instanceof Error ? err.message : 'Failed to fetch logs';
    }
  }

  render() {
    const running = this.containers.filter((container) => container.state === 'running').length;
    const stopped = this.containers.filter((container) => container.state !== 'running').length;

    return html`
      <div class="page-title">Docker Containers</div>
      ${this.error ? html`<div class="error">${this.error}</div>` : ''}

      ${this.loading ? html`<n04h-loading-state label="Querying Docker engine"></n04h-loading-state>` : html`
        <div class="summary">
          <div class="summary-item"><div class="summary-value" style="color: var(--success)">${running}</div><div class="summary-label">Running</div></div>
          <div class="summary-item"><div class="summary-value" style="color: ${stopped > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${stopped}</div><div class="summary-label">Stopped</div></div>
          <div class="summary-item"><div class="summary-value">${this.containers.length}</div><div class="summary-label">Total</div></div>
        </div>

        ${this.containers.length === 0 ? html`<n04h-empty-state title="No containers" detail="The Docker socket did not return any containers."></n04h-empty-state>` : html`
          <div class="containers-grid">
            ${this.containers.map((container) => html`
              <div class="container-card">
                <div class="container-header">
                  <div class="container-status ${container.state}"></div>
                  <span class="container-name">${container.name}</span>
                  ${container.composeProject ? html`<span class="container-project">${container.composeProject}</span>` : ''}
                </div>
                <div class="container-image">${container.image}</div>
                <div class="container-status-text">${container.status}</div>
                ${container.stats ? html`
                  <div class="container-stats">
                    <div class="container-stat"><span class="container-stat-label">CPU: </span><span class="container-stat-value">${container.stats.cpuPercent.toFixed(1)}%</span></div>
                    <div class="container-stat"><span class="container-stat-label">RAM: </span><span class="container-stat-value">${formatBytes(container.stats.memoryUsage)}</span></div>
                    <div class="container-stat"><span class="container-stat-label">Net RX: </span><span class="container-stat-value">${formatBytes(container.stats.netRx)}</span></div>
                    <div class="container-stat"><span class="container-stat-label">Net TX: </span><span class="container-stat-value">${formatBytes(container.stats.netTx)}</span></div>
                  </div>
                ` : ''}
                <button class="logs-btn" @click=${() => void this.showLogs(container.id)}>View Logs</button>
              </div>
            `)}
          </div>
        `}
      `}

      ${this.selectedLogs ? html`
        <div class="logs-modal" @click=${(e: Event) => { if ((e.target as HTMLElement).classList.contains('logs-modal')) this.selectedLogs = null; }}>
          <div class="logs-content">
            <div class="logs-header">
              <span class="logs-title">Container Logs</span>
              <button class="logs-close" @click=${() => this.selectedLogs = null}>✕</button>
            </div>
            <div class="logs-body">${this.logs}</div>
          </div>
        </div>
      ` : ''}
    `;
  }
}
