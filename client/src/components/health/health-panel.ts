import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import '../shared/card.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

@customElement('pg-health-panel')
export class HealthPanel extends LitElement {
  @state() private checks: any[] = [];
  @state() private uptimes: Map<number, any> = new Map();
  @state() private showAdd = false;
  @state() private loading = true;
  @state() private error = '';
  @state() private busyCheckId: number | null = null;
  @state() private newCheck = { name: '', type: 'http', target: '', interval_s: 60 };

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host { display: block; padding: clamp(16px, 2vw, 28px); overflow-y: auto; height: 100%; min-height: 0; box-sizing: border-box; }
    .page-title { font-family: var(--font-mono); font-size: 18px; font-weight: 600; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }

    .add-btn {
      padding: 8px 16px;
      background: var(--accent);
      color: var(--bg-primary);
      border: none;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
    }

    .checks-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }

    .check-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px;
      min-height: 210px;
      display: grid;
      gap: 10px;
    }

    .check-header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .check-header-main { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
    .check-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    .check-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .check-status-dot.up { background: var(--success); box-shadow: 0 0 8px var(--success); }
    .check-status-dot.down { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
    .check-status-dot.unknown { background: var(--warning); box-shadow: 0 0 8px var(--warning); }

    .check-name { font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .check-type { font-size: 10px; padding: 2px 6px; background: var(--accent-dim); color: var(--accent); border-radius: 999px; font-family: var(--font-mono); }
    .action-btn {
      padding: 5px 10px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 10px;
      cursor: pointer;
    }
    .action-btn:hover { border-color: var(--accent); color: var(--accent); }
    .action-btn.danger:hover { border-color: var(--danger); color: var(--danger); }
    .action-btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .check-target { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); word-break: break-all; }
    .meta-row { display: flex; gap: 14px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); }
    .error-text { color: var(--danger); font-family: var(--font-mono); font-size: 11px; }

    .uptime-bars { display: flex; gap: 12px; margin-top: auto; flex-wrap: wrap; }
    .uptime-item { text-align: center; }
    .uptime-value { font-family: var(--font-mono); font-size: 16px; font-weight: 700; }
    .uptime-label { font-family: var(--font-mono); font-size: 9px; color: var(--text-muted); text-transform: uppercase; }

    .form-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }

    .form-card {
      background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: 24px; width: min(100%, 420px);
    }

    .form-title { font-family: var(--font-mono); font-size: 14px; font-weight: 600; margin-bottom: 16px; }

    .form-field { margin-bottom: 12px; }
    .form-field label { display: block; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; }
    .form-field input, .form-field select {
      width: 100%; padding: 8px 12px; background: var(--bg-primary); border: 1px solid var(--border);
      border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font-mono); font-size: 13px;
    }

    .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .form-actions button { padding: 8px 16px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 12px; cursor: pointer; border: none; }
    .btn-primary { background: var(--accent); color: var(--bg-primary); font-weight: 600; }
    .btn-cancel { background: none; border: 1px solid var(--border) !important; color: var(--text-secondary); }

    .error-banner {
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
    void this.fetchChecks();
    this.refreshInterval = setInterval(() => void this.fetchChecks(), 30000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  private async fetchChecks() {
    this.loading = this.checks.length === 0;
    this.error = '';

    try {
      const checks = await apiFetch<any[]>('/api/v1/checks');
      this.checks = checks;
      const uptimeEntries = await Promise.all(
        this.checks.map(async (check) => {
          const uptime = await apiFetch(`/api/v1/checks/${check.id}/uptime`);
          return [check.id, uptime] as const;
        })
      );
      this.uptimes = new Map(uptimeEntries);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load health checks';
    } finally {
      this.loading = false;
    }
  }

  private getUptimeColor(pct: number): string {
    if (pct >= 99.5) return 'var(--success)';
    if (pct >= 95) return 'var(--warning)';
    return 'var(--danger)';
  }

  private getStatusClass(check: any) {
    if (!check.enabled) return 'unknown';
    return check.last_status === 'down' ? 'down' : check.last_status === 'up' ? 'up' : 'unknown';
  }

  private async addCheck() {
    try {
      await apiFetch('/api/v1/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.newCheck),
      });
      this.showAdd = false;
      this.newCheck = { name: '', type: 'http', target: '', interval_s: 60 };
      await this.fetchChecks();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to add health check';
    }
  }

  private async toggleCheck(check: any) {
    this.error = '';
    this.busyCheckId = check.id;
    try {
      await apiFetch(`/api/v1/checks/${check.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: check.enabled ? 0 : 1 }),
      });
      await this.fetchChecks();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to update health check';
    } finally {
      this.busyCheckId = null;
    }
  }

  private async deleteCheck(check: any) {
    if (!window.confirm(`Delete health check "${check.name}"?`)) return;

    this.error = '';
    this.busyCheckId = check.id;
    try {
      await apiFetch(`/api/v1/checks/${check.id}`, { method: 'DELETE' });
      await this.fetchChecks();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to delete health check';
    } finally {
      this.busyCheckId = null;
    }
  }

  render() {
    return html`
      <div class="page-title">
        Health Checks
        <button class="add-btn" @click=${() => this.showAdd = true}>+ Add Check</button>
      </div>

      ${this.error ? html`<div class="error-banner">${this.error}</div>` : ''}
      ${this.loading ? html`<pg-loading-state label="Loading checks"></pg-loading-state>` : ''}
      ${!this.loading && this.checks.length === 0 ? html`<pg-empty-state title="No checks" detail="Create your first uptime check to monitor an external service."></pg-empty-state>` : ''}

      ${!this.loading && this.checks.length > 0 ? html`
        <div class="checks-grid">
          ${this.checks.map((check: any) => {
            const uptime = this.uptimes.get(check.id);
            const statusClass = this.getStatusClass(check);
            return html`
              <div class="check-card">
                <div class="check-header">
                  <div class="check-header-main">
                    <div class="check-status-dot ${statusClass}"></div>
                    <span class="check-name">${check.name}</span>
                    <span class="check-type">${check.type.toUpperCase()}</span>
                  </div>
                  <div class="check-actions">
                    <button class="action-btn" @click=${() => void this.toggleCheck(check)} ?disabled=${this.busyCheckId === check.id}>
                      ${check.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button class="action-btn danger" @click=${() => void this.deleteCheck(check)} ?disabled=${this.busyCheckId === check.id}>
                      Delete
                    </button>
                  </div>
                </div>
                <div class="check-target">${check.target}</div>
                <div class="meta-row">
                  <span>Interval: ${check.interval_s}s</span>
                  <span>Last: ${check.last_checked ? new Date(check.last_checked).toLocaleString() : 'Never'}</span>
                  ${check.last_latency_ms ? html`<span>Latency: ${Math.round(check.last_latency_ms)} ms</span>` : ''}
                </div>
                ${check.last_error ? html`<div class="error-text">${check.last_error}</div>` : ''}
                ${uptime ? html`
                  <div class="uptime-bars">
                    ${Object.entries(uptime).map(([period, pct]) => html`
                      <div class="uptime-item">
                        <div class="uptime-value" style="color: ${this.getUptimeColor(pct as number)}">${(pct as number).toFixed(1)}%</div>
                        <div class="uptime-label">${period}</div>
                      </div>
                    `)}
                  </div>
                ` : ''}
              </div>
            `;
          })}
        </div>
      ` : ''}

      ${this.showAdd ? html`
        <div class="form-overlay" @click=${(e: Event) => { if ((e.target as HTMLElement).classList.contains('form-overlay')) this.showAdd = false; }}>
          <div class="form-card">
            <div class="form-title">Add Health Check</div>
            <div class="form-field">
              <label>Name</label>
              <input .value=${this.newCheck.name} @input=${(e: Event) => this.newCheck = { ...this.newCheck, name: (e.target as HTMLInputElement).value }} />
            </div>
            <div class="form-field">
              <label>Type</label>
              <select .value=${this.newCheck.type} @change=${(e: Event) => this.newCheck = { ...this.newCheck, type: (e.target as HTMLSelectElement).value }}>
                <option value="http">HTTP</option>
                <option value="tcp">TCP</option>
                <option value="dns">DNS</option>
                <option value="icmp">ICMP</option>
              </select>
            </div>
            <div class="form-field">
              <label>Target</label>
              <input .value=${this.newCheck.target} @input=${(e: Event) => this.newCheck = { ...this.newCheck, target: (e.target as HTMLInputElement).value }} placeholder="https://example.com" />
            </div>
            <div class="form-field">
              <label>Interval (seconds)</label>
              <input type="number" .value=${String(this.newCheck.interval_s)} @input=${(e: Event) => this.newCheck = { ...this.newCheck, interval_s: parseInt((e.target as HTMLInputElement).value, 10) || 60 }} />
            </div>
            <div class="form-actions">
              <button class="btn-cancel" @click=${() => this.showAdd = false}>Cancel</button>
              <button class="btn-primary" @click=${() => void this.addCheck()}>Add Check</button>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }
}
