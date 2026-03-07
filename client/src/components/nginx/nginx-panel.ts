import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

@customElement('n04h-nginx-panel')
export class NginxPanel extends LitElement {
  @state() private stats: any = null;
  @state() private errors: string[] = [];
  @state() private vhosts: string[] = [];
  @state() private tab: 'stats' | 'errors' | 'vhosts' = 'stats';
  @state() private loading = true;
  @state() private error = '';

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host { display: block; padding: clamp(16px, 2vw, 28px); overflow-y: auto; height: 100%; min-height: 0; box-sizing: border-box; }
    .page-title { font-family: var(--font-mono); font-size: 18px; font-weight: 600; margin-bottom: 24px; }

    .tabs { display: flex; gap: 6px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 8px; overflow-x: auto; }
    .tab { padding: 8px 16px; background: none; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-secondary); font-family: var(--font-mono); font-size: 12px; cursor: pointer; white-space: nowrap; }
    .tab:hover { background: var(--accent-dim); }
    .tab.active { background: var(--accent-dim); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 24%, transparent); }

    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .summary-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px; text-align: center; }
    .summary-value { font-family: var(--font-mono); font-size: 24px; font-weight: 700; }
    .summary-label { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; margin-top: 4px; }

    .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .top-list { border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px; background: var(--bg-card); }
    .top-title { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
    .top-item { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-family: var(--font-mono); font-size: 11px; }
    .top-item:last-child { border-bottom: none; }
    .top-key { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
    .top-count { color: var(--accent); font-weight: 600; }

    .error-line { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); padding: 8px 10px; border-bottom: 1px solid var(--border); word-break: break-word; background: var(--bg-card); }
    .vhost-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px; margin-bottom: 8px; }
    .vhost-name { font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--accent); }

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
    void this.fetchData();
    this.refreshInterval = setInterval(() => void this.fetchData(), 15000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  private async fetchData() {
    this.loading = this.stats === null && this.errors.length === 0 && this.vhosts.length === 0;
    this.error = '';
    try {
      const [stats, errors, vhosts] = await Promise.all([
        apiFetch('/api/v1/nginx/stats'),
        apiFetch<string[]>('/api/v1/nginx/errors'),
        apiFetch<string[]>('/api/v1/nginx/vhosts'),
      ]);
      this.stats = stats;
      this.errors = errors;
      this.vhosts = vhosts;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load nginx data';
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="page-title">Nginx</div>
      <div class="tabs">
        ${(['stats', 'errors', 'vhosts'] as const).map((tabName) => html`
          <button class="tab ${this.tab === tabName ? 'active' : ''}" @click=${() => this.tab = tabName}>${tabName.charAt(0).toUpperCase() + tabName.slice(1)}</button>
        `)}
      </div>

      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.loading ? html`<n04h-loading-state label="Loading nginx telemetry"></n04h-loading-state>` : this.renderCurrentTab()}
    `;
  }

  private renderCurrentTab() {
    switch (this.tab) {
      case 'stats':
        return this.renderStats();
      case 'errors':
        return this.renderErrors();
      case 'vhosts':
        return this.renderVhosts();
      default:
        return this.renderStats();
    }
  }

  private renderStats() {
    if (!this.stats) return html`<n04h-empty-state title="No nginx stats" detail="No access log entries could be parsed from the mounted environment."></n04h-empty-state>`;
    const stats = this.stats;
    return html`
      <div class="summary-grid">
        <div class="summary-card"><div class="summary-value">${stats.totalRequests}</div><div class="summary-label">Total Requests</div></div>
        <div class="summary-card"><div class="summary-value" style="color: var(--accent)">${stats.websocketConnections ?? 0}</div><div class="summary-label">WebSocket Connections</div></div>
        <div class="summary-card"><div class="summary-value" style="color: var(--success)">${stats.statusCodes?.['2xx'] ?? 0}</div><div class="summary-label">2xx</div></div>
        <div class="summary-card"><div class="summary-value" style="color: var(--info)">${stats.statusCodes?.['3xx'] ?? 0}</div><div class="summary-label">3xx</div></div>
        <div class="summary-card"><div class="summary-value" style="color: var(--warning)">${stats.statusCodes?.['4xx'] ?? 0}</div><div class="summary-label">4xx</div></div>
        <div class="summary-card"><div class="summary-value" style="color: var(--danger)">${stats.statusCodes?.['5xx'] ?? 0}</div><div class="summary-label">5xx</div></div>
      </div>

      <div class="two-col">
        <div class="top-list">
          <div class="top-title">Top URIs</div>
          ${(stats.topUris ?? []).length ? stats.topUris.map((entry: any) => html`<div class="top-item"><span class="top-key">${entry.key}</span><span class="top-count">${entry.count}</span></div>`) : html`<n04h-empty-state title="No URIs"></n04h-empty-state>`}
        </div>
        <div class="top-list">
          <div class="top-title">Top IPs</div>
          ${(stats.topIps ?? []).length ? stats.topIps.map((entry: any) => html`<div class="top-item"><span class="top-key">${entry.key}</span><span class="top-count">${entry.count}</span></div>`) : html`<n04h-empty-state title="No clients"></n04h-empty-state>`}
        </div>
        <div class="top-list">
          <div class="top-title">Top VHosts</div>
          ${(stats.topVhosts ?? []).length ? stats.topVhosts.map((entry: any) => html`<div class="top-item"><span class="top-key">${entry.key}</span><span class="top-count">${entry.count}</span></div>`) : html`<n04h-empty-state title="No vhosts"></n04h-empty-state>`}
        </div>
      </div>
    `;
  }

  private renderErrors() {
    if (this.errors.length === 0) {
      return html`<n04h-empty-state title="No recent errors" detail="The error log is clean or not mounted in the dashboard container."></n04h-empty-state>`;
    }
    return html`${this.errors.map((line) => html`<div class="error-line">${line}</div>`)}`;
  }

  private renderVhosts() {
    if (this.vhosts.length === 0) {
      return html`<n04h-empty-state title="No vhosts detected" detail="No nginx site configuration could be discovered from the mounted config paths."></n04h-empty-state>`;
    }
    return html`${this.vhosts.map((vhost) => html`<div class="vhost-card"><div class="vhost-name">${vhost}</div></div>`)}`;
  }
}
