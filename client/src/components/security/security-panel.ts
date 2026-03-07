import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import '../shared/card.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

@customElement('n04h-security-panel')
export class SecurityPanel extends LitElement {
  @state() private score: any = null;
  @state() private fail2ban: any[] = [];
  @state() private authEvents: any[] = [];
  @state() private loginHistory: any[] = [];
  @state() private tab: 'overview' | 'fail2ban' | 'auth' | 'logins' = 'overview';
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

    .score-display { text-align: center; margin-bottom: 24px; }
    .score-value { font-family: var(--font-mono); font-size: clamp(54px, 10vw, 78px); font-weight: 700; line-height: 1; }
    .score-label { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); margin-top: 8px; text-transform: uppercase; }

    .checks-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
    .check-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .check-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .check-dot.pass { background: var(--success); }
    .check-dot.fail { background: var(--danger); }
    .check-dot.unknown { background: var(--warning); }
    .check-name { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); }
    .check-weight { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); margin-left: auto; }
    .check-detail { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

    .jail-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px; margin-bottom: 8px; }
    .jail-name { font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--accent); margin-bottom: 8px; }
    .jail-stats { display: flex; gap: 20px; font-family: var(--font-mono); font-size: 12px; flex-wrap: wrap; }
    .jail-ips { margin-top: 8px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }

    .table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-md); }
    .table { width: 100%; min-width: 680px; border-collapse: collapse; }
    .table th, .table td { padding: 8px 10px; text-align: left; font-family: var(--font-mono); font-size: 11px; border-bottom: 1px solid var(--border); }
    .table th { color: var(--text-muted); text-transform: uppercase; font-size: 10px; background: color-mix(in srgb, var(--bg-secondary) 90%, transparent); }

    .event-type { display: inline-block; padding: 2px 6px; border-radius: 999px; font-size: 10px; font-family: var(--font-mono); font-weight: 600; }
    .event-type.ssh_failed { background: var(--danger-dim); color: var(--danger); }
    .event-type.ssh_success { background: var(--success-dim); color: var(--success); }
    .event-type.ssh_invalid_user { background: var(--warning-dim); color: var(--warning); }
    .event-type.sudo { background: var(--accent-dim); color: var(--accent); }

    .error {
      margin-bottom: 16px;
      padding: 10px 14px;
      background: var(--danger-dim);
      border-radius: var(--radius-sm);
      color: var(--danger);
      font-family: var(--font-mono);
      font-size: 12px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.fetchData();
    this.refreshInterval = setInterval(() => void this.fetchData(), 30000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  private async fetchData() {
    this.loading = this.score === null;
    this.error = '';

    try {
      const [score, fail2ban, authEvents, loginHistory] = await Promise.all([
        apiFetch('/api/v1/security/score'),
        apiFetch<any[]>('/api/v1/security/fail2ban'),
        apiFetch<any[]>('/api/v1/security/auth-log'),
        apiFetch<any[]>('/api/v1/auth/login-history'),
      ]);

      this.score = score;
      this.fail2ban = fail2ban;
      this.authEvents = authEvents;
      this.loginHistory = loginHistory;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load security telemetry';
    } finally {
      this.loading = false;
    }
  }

  private getScoreColor(score: number): string {
    if (score >= 80) return 'var(--success)';
    if (score >= 60) return 'var(--warning)';
    return 'var(--danger)';
  }

  render() {
    return html`
      <div class="page-title">Security</div>
      <div class="tabs">
        ${(['overview', 'fail2ban', 'auth', 'logins'] as const).map((tabName) => html`
          <button class="tab ${this.tab === tabName ? 'active' : ''}" @click=${() => this.tab = tabName}>${tabName.charAt(0).toUpperCase() + tabName.slice(1)}</button>
        `)}
      </div>

      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.loading ? html`<n04h-loading-state label="Loading security posture"></n04h-loading-state>` : ''}
      ${!this.loading ? this.renderCurrentTab() : ''}
    `;
  }

  private renderCurrentTab() {
    switch (this.tab) {
      case 'overview':
        return this.renderOverview();
      case 'fail2ban':
        return this.renderFail2ban();
      case 'auth':
        return this.renderAuth();
      case 'logins':
        return this.renderLogins();
      default:
        return this.renderOverview();
    }
  }

  private renderOverview() {
    if (!this.score) {
      return html`<n04h-empty-state title="No score" detail="Security controls could not be evaluated."></n04h-empty-state>`;
    }

    return html`
      <div class="score-display">
        <div class="score-value" style="color: ${this.getScoreColor(this.score.score)}">${this.score.score}</div>
        <div class="score-label">Security Score</div>
      </div>
      <div class="checks-list">
        ${(this.score.checks ?? []).map((check: any) => html`
          <div class="check-item">
            <div class="check-dot ${check.status ?? (check.passed ? 'pass' : 'fail')}"></div>
            <div>
              <div class="check-name">${check.name}</div>
              ${check.details ? html`<div class="check-detail">${check.details}</div>` : ''}
            </div>
            <span class="check-weight">${check.weight}pts</span>
          </div>
        `)}
      </div>
    `;
  }

  private renderFail2ban() {
    if (this.fail2ban.length === 0) {
      return html`<n04h-empty-state title="No fail2ban data" detail="No jail status could be derived from the mounted logs or runtime."></n04h-empty-state>`;
    }

    return html`
      ${this.fail2ban.map((jail) => html`
        <div class="jail-card">
          <div class="jail-name">${jail.name}</div>
          <div class="jail-stats">
            <span>Currently banned: <strong style="color: var(--danger)">${jail.currentlyBanned}</strong></span>
            <span>Total banned: <strong>${jail.totalBanned}</strong></span>
          </div>
          ${jail.bannedIps.length > 0 ? html`<div class="jail-ips">Banned IPs: ${jail.bannedIps.join(', ')}</div>` : ''}
        </div>
      `)}
    `;
  }

  private renderAuth() {
    if (this.authEvents.length === 0) {
      return html`<n04h-empty-state title="No auth events" detail="auth.log is empty, inaccessible, or no matching SSH/sudo events were found."></n04h-empty-state>`;
    }

    return html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Time</th><th>Type</th><th>User</th><th>IP</th></tr></thead>
          <tbody>
            ${this.authEvents.slice(0, 100).map((event) => html`
              <tr>
                <td>${event.timestamp}</td>
                <td><span class="event-type ${event.type}">${event.type}</span></td>
                <td>${event.user ?? '-'}</td>
                <td>${event.ip ?? '-'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderLogins() {
    if (this.loginHistory.length === 0) {
      return html`<n04h-empty-state title="No login history" detail="Authentication attempts will appear here once users start interacting with the dashboard."></n04h-empty-state>`;
    }

    return html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Time</th><th>IP</th><th>Username</th><th>Status</th></tr></thead>
          <tbody>
            ${this.loginHistory.map((login: any) => html`
              <tr>
                <td>${new Date(login.timestamp).toLocaleString()}</td>
                <td>${login.ip}</td>
                <td>${login.username}</td>
                <td><span class="event-type ${login.success ? 'ssh_success' : 'ssh_failed'}">${login.success ? 'Success' : 'Failed'}</span></td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }
}
