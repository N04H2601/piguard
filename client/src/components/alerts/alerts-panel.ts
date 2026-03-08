import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import { formatLocalDateTime } from '../../lib/datetime.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

const AVAILABLE_CHANNELS = ['telegram', 'email'] as const;
const SEVERITY_OPTIONS = ['info', 'warning', 'critical'] as const;
const CONDITION_OPTIONS = ['>', '<', '>=', '<=', '=='] as const;

@customElement('pg-alerts-panel')
export class AlertsPanel extends LitElement {
  @state() private rules: any[] = [];
  @state() private active: any[] = [];
  @state() private history: any[] = [];
  @state() private tab: 'active' | 'history' | 'rules' = 'active';
  @state() private loading = true;
  @state() private error = '';
  @state() private clearingHistory = false;

  // New rule form
  @state() private showForm = false;
  @state() private editingId: number | null = null;
  @state() private formName = '';
  @state() private formMetric = '';
  @state() private formCondition = '>';
  @state() private formThreshold = '';
  @state() private formDuration = '0';
  @state() private formCooldown = '300';
  @state() private formSeverity = 'warning';
  @state() private formChannels: string[] = [];

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

    .ack-btn, .rule-btn {
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
    .rule-btn:hover { border-color: var(--accent); color: var(--accent); }
    .rule-btn.danger:hover { border-color: var(--danger); color: var(--danger); }

    .rule-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rule-name { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .rule-details { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-top: 6px; }
    .rule-actions { display: flex; gap: 6px; align-items: center; }

    .channel-tags { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
    .channel-tag {
      padding: 2px 8px;
      border-radius: 999px;
      font-family: var(--font-mono);
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: var(--accent-dim);
      color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    }
    .no-channels { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); margin-top: 8px; }

    .error {
      margin-bottom: 16px;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      background: var(--danger-dim);
      color: var(--danger);
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .tab-actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 12px;
    }

    .rule-form {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 20px;
      margin-bottom: 16px;
      display: grid;
      gap: 14px;
    }

    .form-title { font-family: var(--font-mono); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-primary); }

    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .form-field { display: grid; gap: 4px; }
    .form-label { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; }

    input, select {
      width: 100%; padding: 8px 10px;
      background: var(--bg-primary); border: 1px solid var(--border);
      border-radius: var(--radius-sm); color: var(--text-primary);
      font-family: var(--font-mono); font-size: 12px; box-sizing: border-box;
    }

    .channels-group { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .channel-checkbox { display: flex; align-items: center; gap: 5px; cursor: pointer; }
    .channel-checkbox input[type="checkbox"] { width: auto; padding: 0; cursor: pointer; accent-color: var(--accent); }
    .channel-checkbox span { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }

    .form-actions { display: flex; gap: 8px; }
    .btn {
      padding: 8px 14px; border: none; border-radius: var(--radius-sm);
      font-family: var(--font-mono); font-size: 11px; cursor: pointer; font-weight: 600;
    }
    .btn-primary { background: var(--accent); color: var(--bg-primary); }
    .btn-outline { background: none; border: 1px solid var(--border); color: var(--text-secondary); }
    .btn-new { margin-bottom: 16px; }
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

  private async clearHistory() {
    this.error = '';
    this.clearingHistory = true;
    try {
      await apiFetch('/api/v1/alerts/history', { method: 'DELETE' });
      await this.fetchData();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to clear alert history';
    } finally {
      this.clearingHistory = false;
    }
  }

  private async toggleRule(rule: any) {
    try {
      await apiFetch(`/api/v1/alerts/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: rule.enabled ? 0 : 1 }),
      });
      await this.fetchData();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to toggle rule';
    }
  }

  private async deleteRule(id: number) {
    try {
      await apiFetch(`/api/v1/alerts/rules/${id}`, { method: 'DELETE' });
      await this.fetchData();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to delete rule';
    }
  }

  private resetForm() {
    this.showForm = false;
    this.editingId = null;
    this.formName = '';
    this.formMetric = '';
    this.formCondition = '>';
    this.formThreshold = '';
    this.formDuration = '0';
    this.formCooldown = '300';
    this.formSeverity = 'warning';
    this.formChannels = [];
  }

  private editRule(rule: any) {
    this.editingId = rule.id;
    this.formName = rule.name;
    this.formMetric = rule.metric;
    this.formCondition = rule.condition;
    this.formThreshold = String(rule.threshold);
    this.formDuration = String(rule.duration_s ?? 0);
    this.formCooldown = String(rule.cooldown_s ?? 300);
    this.formSeverity = rule.severity ?? 'warning';
    try {
      this.formChannels = JSON.parse(rule.channels || '[]');
    } catch {
      this.formChannels = [];
    }
    this.showForm = true;
  }

  private toggleChannel(ch: string) {
    if (this.formChannels.includes(ch)) {
      this.formChannels = this.formChannels.filter((c) => c !== ch);
    } else {
      this.formChannels = [...this.formChannels, ch];
    }
  }

  private async saveRule() {
    this.error = '';
    if (!this.formName.trim() || !this.formMetric.trim() || !this.formThreshold.trim()) {
      this.error = 'Name, metric, and threshold are required.';
      return;
    }

    const body = {
      name: this.formName.trim(),
      metric: this.formMetric.trim(),
      condition: this.formCondition,
      threshold: Number(this.formThreshold),
      duration_s: Number(this.formDuration) || 0,
      cooldown_s: Number(this.formCooldown) || 300,
      severity: this.formSeverity,
      channels: this.formChannels,
    };

    try {
      if (this.editingId) {
        await apiFetch(`/api/v1/alerts/rules/${this.editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/v1/alerts/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      this.resetForm();
      await this.fetchData();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save rule';
    }
  }

  private parseChannels(rule: any): string[] {
    try {
      return JSON.parse(rule.channels || '[]');
    } catch {
      return [];
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
      ${this.loading ? html`<pg-loading-state label="Loading alerts"></pg-loading-state>` : ''}
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
    if (this.active.length === 0) return html`<pg-empty-state title="No active alerts" detail="The alert engine is currently quiet."></pg-empty-state>`;
    return html`${this.active.map((alert: any) => html`
      <div class="alert-card">
        <div class="severity-dot ${alert.severity}"></div>
        <div class="alert-info">
          <div class="alert-name">${alert.rule_name}</div>
          <div class="alert-message">${alert.message}</div>
          <div class="alert-time">${formatLocalDateTime(alert.fired_at, alert.fired_at)}</div>
        </div>
        ${!alert.acknowledged ? html`<button class="ack-btn" @click=${() => void this.ackAlert(alert.id)}>Dismiss</button>` : ''}
      </div>
    `)}`;
  }

  private renderHistory() {
    if (this.history.length === 0) return html`<pg-empty-state title="No alert history" detail="Resolved and dismissed alerts will accumulate here over time."></pg-empty-state>`;
    return html`
      <div class="tab-actions">
        <button class="btn btn-outline" @click=${() => void this.clearHistory()} ?disabled=${this.clearingHistory}>
          ${this.clearingHistory ? 'Clearing...' : 'Clear History'}
        </button>
      </div>
      ${this.history.map((alert: any) => html`
      <div class="alert-card" style="opacity: ${alert.status === 'resolved' ? 0.6 : 1}">
        <div class="severity-dot ${alert.severity}"></div>
        <div class="alert-info">
          <div class="alert-name">${alert.rule_name} <span style="font-size: 10px; color: var(--text-muted)">[${this.historyStatusLabel(alert)}]</span></div>
          <div class="alert-message">${alert.message}</div>
          <div class="alert-time">
            Fired: ${formatLocalDateTime(alert.fired_at)}
            ${alert.resolved_at ? ` | Resolved: ${formatLocalDateTime(alert.resolved_at)}` : ''}
            ${alert.status === 'dismissed' ? ' | Hidden until recovery' : ''}
          </div>
        </div>
      </div>
      `)}
    `;
  }

  private historyStatusLabel(alert: any) {
    if (alert.status === 'dismissed') return 'dismissed';
    if (alert.status === 'resolved') return 'resolved';
    return alert.status ?? 'unknown';
  }

  private renderRules() {
    return html`
      ${!this.showForm ? html`
        <button class="btn btn-primary btn-new" @click=${() => { this.resetForm(); this.showForm = true; }}>New Rule</button>
      ` : ''}

      ${this.showForm ? this.renderForm() : ''}

      ${this.rules.length === 0 && !this.showForm ? html`<pg-empty-state title="No rules" detail="Create alert rules to watch your metrics automatically."></pg-empty-state>` : ''}

      ${this.rules.map((rule: any) => {
        const channels = this.parseChannels(rule);
        return html`
          <div class="rule-card">
            <div class="rule-header">
              <span class="rule-name">${rule.name}</span>
              <div class="rule-actions">
                <button class="rule-btn" @click=${() => this.editRule(rule)}>Edit</button>
                <button class="rule-btn" @click=${() => void this.toggleRule(rule)}>${rule.enabled ? 'Disable' : 'Enable'}</button>
                <button class="rule-btn danger" @click=${() => void this.deleteRule(rule.id)}>Delete</button>
                <span style="font-family: var(--font-mono); font-size: 10px; color: ${rule.enabled ? 'var(--success)' : 'var(--text-muted)'}">${rule.enabled ? 'ON' : 'OFF'}</span>
              </div>
            </div>
            <div class="rule-details">${rule.metric} ${rule.condition} ${rule.threshold} | Duration: ${rule.duration_s}s | Cooldown: ${rule.cooldown_s}s | Severity: ${rule.severity}</div>
            ${channels.length > 0
              ? html`<div class="channel-tags">${channels.map((ch: string) => html`<span class="channel-tag">${ch}</span>`)}</div>`
              : html`<div class="no-channels">No notification channels</div>`}
          </div>
        `;
      })}
    `;
  }

  private renderForm() {
    return html`
      <div class="rule-form">
        <div class="form-title">${this.editingId ? 'Edit Rule' : 'New Rule'}</div>
        <div class="form-grid">
          <div class="form-field">
            <span class="form-label">Name</span>
            <input .value=${this.formName} @input=${(e: Event) => this.formName = (e.target as HTMLInputElement).value} placeholder="High CPU" />
          </div>
          <div class="form-field">
            <span class="form-label">Metric</span>
            <input .value=${this.formMetric} @input=${(e: Event) => this.formMetric = (e.target as HTMLInputElement).value} placeholder="cpu_percent" />
          </div>
          <div class="form-field">
            <span class="form-label">Condition</span>
            <select .value=${this.formCondition} @change=${(e: Event) => this.formCondition = (e.target as HTMLSelectElement).value}>
              ${CONDITION_OPTIONS.map((c) => html`<option value=${c}>${c}</option>`)}
            </select>
          </div>
          <div class="form-field">
            <span class="form-label">Threshold</span>
            <input type="number" .value=${this.formThreshold} @input=${(e: Event) => this.formThreshold = (e.target as HTMLInputElement).value} placeholder="90" />
          </div>
          <div class="form-field">
            <span class="form-label">Duration (s)</span>
            <input type="number" .value=${this.formDuration} @input=${(e: Event) => this.formDuration = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">Cooldown (s)</span>
            <input type="number" .value=${this.formCooldown} @input=${(e: Event) => this.formCooldown = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">Severity</span>
            <select .value=${this.formSeverity} @change=${(e: Event) => this.formSeverity = (e.target as HTMLSelectElement).value}>
              ${SEVERITY_OPTIONS.map((s) => html`<option value=${s}>${s}</option>`)}
            </select>
          </div>
        </div>
        <div class="form-field">
          <span class="form-label">Notification Channels</span>
          <div class="channels-group">
            ${AVAILABLE_CHANNELS.map((ch) => html`
              <label class="channel-checkbox">
                <input type="checkbox" .checked=${this.formChannels.includes(ch)} @change=${() => this.toggleChannel(ch)} />
                <span>${ch}</span>
              </label>
            `)}
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click=${() => void this.saveRule()}>${this.editingId ? 'Update' : 'Create'}</button>
          <button class="btn btn-outline" @click=${() => this.resetForm()}>Cancel</button>
        </div>
      </div>
    `;
  }
}
