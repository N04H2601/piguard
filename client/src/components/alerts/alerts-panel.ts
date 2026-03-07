import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

@customElement('n04h-alerts-panel')
export class AlertsPanel extends LitElement {
  @state() private rules: any[] = [];
  @state() private active: any[] = [];
  @state() private history: any[] = [];
  @state() private tab: 'active' | 'history' | 'rules' = 'active';
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

    .alert-card,
    .rule-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px;
      margin-bottom: 10px;
    }

    .alert-card { display: flex; align-items: center; gap: 12px; }

    .severity-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .severity-dot.critical { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
    .severity-dot.warning { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
    .severity-dot.info { background: var(--info); }

    .alert-info { flex: 1; }
    .alert-name { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .alert-message { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-top: 4px; }
    .alert-time { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    .ack-btn {
      padding: 5px 10px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 10px;
      cursor: pointer;
    }
    .ack-btn:hover { border-color: var(--success); color: var(--success); }

    .rule-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .rule-name { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .rule-details { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-top: 6px; }

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
    this.loading = this.rules.length === 0 && this.active.length === 0 && this.history.length === 0;
    this.error = '';
    try {
      const [rules, active, history] = await Promise.all([
        apiFetch<any[]>('/api/v1/alerts/rules'),
        apiFetch<any[]>('/api/v1/alerts/active'),
        apiFetch<any[]>('/api/v1/alerts/history'),
      ]);
      this.rules = rules;
      this.active = active;
      this.history = history;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load alerts';
    } finally {
      this.loading = false;
    }
  }

  private async ackAlert(id: number) {
    try {
      await apiFetch(`/api/v1/alerts/acknowledge/${id}`, { method: 'POST' });
      await this.fetchData();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to acknowledge alert';
    }
  }

  render() {
    return html`
      <div class="page-title">Alerts</div>
      <div class="tabs">
        ${(['active', 'history', 'rules'] as const).map((tabName) => html`
          <button class="tab ${this.tab === tabName ? 'active' : ''}" @click=${() => this.tab = tabName}>
            ${tabName.charAt(0).toUpperCase() + tabName.slice(1)}${tabName === 'active' && this.active.length > 0 ? ` (${this.active.length})` : ''}
          </button>
        `)}
      </div>

      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.loading ? html`<n04h-loading-state label="Loading alerts"></n04h-loading-state>` : ''}
      ${!this.loading ? this.renderCurrentTab() : ''}
    `;
  }

  private renderCurrentTab() {
    switch (this.tab) {
      case 'active':
        return this.renderActive();
      case 'history':
        return this.renderHistory();
      case 'rules':
        return this.renderRules();
      default:
        return this.renderActive();
    }
  }

  private renderActive() {
    if (this.active.length === 0) return html`<n04h-empty-state title="No active alerts" detail="The alert engine is currently quiet."></n04h-empty-state>`;
    return html`${this.active.map((alert: any) => html`
      <div class="alert-card">
        <div class="severity-dot ${alert.severity}"></div>
        <div class="alert-info">
          <div class="alert-name">${alert.rule_name}</div>
          <div class="alert-message">${alert.message}</div>
          <div class="alert-time">${alert.fired_at}</div>
        </div>
        ${!alert.acknowledged ? html`<button class="ack-btn" @click=${() => void this.ackAlert(alert.id)}>ACK</button>` : ''}
      </div>
    `)}`;
  }

  private renderHistory() {
    if (this.history.length === 0) return html`<n04h-empty-state title="No alert history" detail="Resolved and fired alerts will accumulate here over time."></n04h-empty-state>`;
    return html`${this.history.map((alert: any) => html`
      <div class="alert-card" style="opacity: ${alert.status === 'resolved' ? 0.6 : 1}">
        <div class="severity-dot ${alert.severity}"></div>
        <div class="alert-info">
          <div class="alert-name">${alert.rule_name} <span style="font-size: 10px; color: var(--text-muted)">[${alert.status}]</span></div>
          <div class="alert-message">${alert.message}</div>
          <div class="alert-time">Fired: ${alert.fired_at}${alert.resolved_at ? ` | Resolved: ${alert.resolved_at}` : ''}</div>
        </div>
      </div>
    `)}`;
  }

  private renderRules() {
    if (this.rules.length === 0) return html`<n04h-empty-state title="No rules" detail="Create alert rules to watch your metrics automatically."></n04h-empty-state>`;
    return html`${this.rules.map((rule: any) => html`
      <div class="rule-card">
        <div class="rule-header">
          <span class="rule-name">${rule.name}</span>
          <span style="font-family: var(--font-mono); font-size: 10px; color: ${rule.enabled ? 'var(--success)' : 'var(--text-muted)'}">${rule.enabled ? 'ENABLED' : 'DISABLED'}</span>
        </div>
        <div class="rule-details">${rule.metric} ${rule.condition} ${rule.threshold} | Duration: ${rule.duration_s}s | Cooldown: ${rule.cooldown_s}s | Severity: ${rule.severity}</div>
      </div>
    `)}`;
  }
}
