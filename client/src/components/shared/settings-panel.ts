import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import { getState, setState, subscribe } from '../../state/store.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

const THEMES = [
  { id: 'default', name: 'Cyber', color: '#00f0ff' },
  { id: 'emerald', name: 'Emerald', color: '#10b981' },
  { id: 'rose', name: 'Rose', color: '#f43f5e' },
  { id: 'amber', name: 'Amber', color: '#f59e0b' },
  { id: 'hacker', name: 'Hacker', color: '#00ff41' },
  { id: 'light', name: 'Light', color: '#0891b2' },
];

@customElement('pg-settings-panel')
export class SettingsPanel extends LitElement {
  @state() private currentTheme = getState().theme;
  @state() private kioskMode = getState().kioskMode;
  @state() private apiKeys: any[] = [];
  @state() private newKeyName = '';
  @state() private loading = true;
  @state() private generatedKey = '';
  @state() private error = '';
  @state() private success = '';

  // Instance settings
  @state() private instanceName = '';
  @state() private language = 'fr';

  // Password
  @state() private currentPassword = '';
  @state() private newPassword = '';
  @state() private newPasswordConfirm = '';

  // Notifications
  @state() private ntfyUrl = '';
  @state() private ntfyTopic = '';
  @state() private telegramBotToken = '';
  @state() private telegramChatId = '';
  @state() private webhookUrl = '';
  @state() private smtpHost = '';
  @state() private smtpPort = '';
  @state() private smtpUser = '';
  @state() private smtpPass = '';
  @state() private smtpFrom = '';
  @state() private smtpTo = '';

  private unsubscribe: (() => void) | null = null;

  static styles = css`
    :host { display: block; padding: clamp(16px, 2vw, 28px); overflow-y: auto; height: 100%; min-height: 0; box-sizing: border-box; }
    .page-title { font-family: var(--font-mono); font-size: 18px; font-weight: 600; margin-bottom: 24px; }

    .section { margin-bottom: 32px; }
    .section-title { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; }

    .theme-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .theme-card {
      padding: 16px;
      background: var(--bg-card);
      border: 2px solid var(--border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
      min-height: 110px;
      display: grid;
      align-content: center;
      gap: 8px;
    }
    .theme-card:hover { border-color: var(--border-active); transform: translateY(-2px); }
    .theme-card.active { border-color: var(--accent); }
    .theme-swatch { width: 28px; height: 28px; border-radius: 50%; margin: 0 auto; box-shadow: 0 0 0 6px color-mix(in srgb, var(--border) 82%, transparent); }
    .theme-name { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }

    .setting-copy { display: grid; gap: 4px; }
    .setting-name { font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.12em; }
    .setting-detail { color: var(--text-muted); font-size: 13px; }

    .toggle {
      width: 54px; height: 30px; border-radius: 999px;
      border: 1px solid var(--border); background: var(--bg-primary);
      position: relative; cursor: pointer;
    }
    .toggle::after {
      content: ''; position: absolute; top: 3px; left: 3px;
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--text-secondary);
      transition: transform 0.2s ease, background 0.2s ease;
    }
    .toggle.active { background: color-mix(in srgb, var(--accent-dim) 86%, transparent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
    .toggle.active::after { transform: translateX(24px); background: var(--accent); }

    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .form-grid.one { grid-template-columns: 1fr; }
    .form-field { display: grid; gap: 6px; }
    .form-label { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; }

    input, select {
      width: 100%; padding: 10px 12px;
      background: var(--bg-primary); border: 1px solid var(--border);
      border-radius: var(--radius-sm); color: var(--text-primary);
      font-family: var(--font-mono); font-size: 12px; box-sizing: border-box;
    }

    .btn {
      padding: 10px 16px; border: none; border-radius: var(--radius-sm);
      font-family: var(--font-mono); font-size: 12px; cursor: pointer; font-weight: 600;
    }
    .btn-primary { background: var(--accent); color: var(--bg-primary); }
    .btn-outline { background: none; border: 1px solid var(--border); color: var(--text-secondary); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .form-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

    .key-list { display: grid; gap: 8px; }
    .key-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--bg-card);
    }
    .key-name { font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); flex: 1; }
    .key-date { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

    .delete-btn {
      padding: 4px 10px; background: none; border: 1px solid var(--danger);
      border-radius: 999px; color: var(--danger); font-size: 10px;
      cursor: pointer; font-family: var(--font-mono);
    }

    .add-key-form { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .add-key-form input { flex: 1; min-width: 200px; }

    .key-display, .error, .success {
      margin-top: 12px; padding: 12px; border-radius: var(--radius-sm);
      font-family: var(--font-mono); font-size: 11px; word-break: break-all;
    }
    .key-display { background: var(--success-dim); border: 1px solid color-mix(in srgb, var(--success) 26%, transparent); color: var(--success); }
    .error { background: var(--danger-dim); border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent); color: var(--danger); }
    .success { background: var(--success-dim); border: 1px solid color-mix(in srgb, var(--success) 26%, transparent); color: var(--success); }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = subscribe(() => {
      const s = getState();
      this.currentTheme = s.theme;
      this.kioskMode = s.kioskMode;
    });
    void this.loadAll();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  private async loadAll() {
    this.loading = true;
    try {
      const [instance, notifications, keys] = await Promise.all([
        apiFetch<{ instanceName: string; language: string }>('/api/v1/settings/instance'),
        apiFetch<any>('/api/v1/settings/notifications'),
        apiFetch<any[]>('/api/v1/auth/api-keys'),
      ]);
      this.instanceName = instance.instanceName ?? 'PiGuard';
      this.language = instance.language ?? 'fr';
      this.ntfyUrl = notifications.ntfyUrl ?? '';
      this.ntfyTopic = notifications.ntfyTopic ?? '';
      this.telegramBotToken = notifications.telegramBotToken ?? '';
      this.telegramChatId = notifications.telegramChatId ?? '';
      this.webhookUrl = notifications.webhookUrl ?? '';
      this.smtpHost = notifications.smtpHost ?? '';
      this.smtpPort = notifications.smtpPort ?? '';
      this.smtpUser = notifications.smtpUser ?? '';
      this.smtpPass = notifications.smtpPass ?? '';
      this.smtpFrom = notifications.smtpFrom ?? '';
      this.smtpTo = notifications.smtpTo ?? '';
      this.apiKeys = keys;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load settings';
    } finally {
      this.loading = false;
    }
  }

  private showSuccess(msg: string) {
    this.success = msg;
    this.error = '';
    setTimeout(() => { this.success = ''; }, 3000);
  }

  private selectTheme(id: string) { setState({ theme: id }); }
  private toggleKioskMode() { setState({ kioskMode: !this.kioskMode }); }

  private async saveInstance() {
    this.error = '';
    try {
      await apiFetch('/api/v1/settings/instance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: this.instanceName, language: this.language }),
      });
      setState({ instanceName: this.instanceName });
      this.showSuccess('Instance settings saved.');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save';
    }
  }

  private async changePassword() {
    this.error = '';
    if (this.newPassword.length < 10) { this.error = 'New password must be at least 10 characters.'; return; }
    if (this.newPassword !== this.newPasswordConfirm) { this.error = 'Passwords do not match.'; return; }
    try {
      await apiFetch('/api/v1/settings/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: this.currentPassword, newPassword: this.newPassword }),
      });
      this.currentPassword = '';
      this.newPassword = '';
      this.newPasswordConfirm = '';
      this.showSuccess('Password changed successfully.');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to change password';
    }
  }

  private async saveNotifications() {
    this.error = '';
    try {
      await apiFetch('/api/v1/settings/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ntfyUrl: this.ntfyUrl,
          ntfyTopic: this.ntfyTopic,
          telegramBotToken: this.telegramBotToken,
          telegramChatId: this.telegramChatId,
          webhookUrl: this.webhookUrl,
          smtpHost: this.smtpHost,
          smtpPort: this.smtpPort,
          smtpUser: this.smtpUser,
          smtpPass: this.smtpPass,
          smtpFrom: this.smtpFrom,
          smtpTo: this.smtpTo,
        }),
      });
      this.showSuccess('Notification settings saved.');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save notifications';
    }
  }

  private async testChannel(channel: string) {
    this.error = '';
    try {
      await apiFetch('/api/v1/settings/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      this.showSuccess(`Test ${channel} notification sent.`);
    } catch (err) {
      this.error = err instanceof Error ? err.message : `Failed to send test ${channel} notification`;
    }
  }

  private async createApiKey() {
    if (!this.newKeyName.trim()) return;
    this.error = '';
    try {
      const data = await apiFetch<{ key: string }>('/api/v1/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.newKeyName }),
      });
      this.generatedKey = data.key;
      this.newKeyName = '';
      this.apiKeys = await apiFetch<any[]>('/api/v1/auth/api-keys');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create API key';
    }
  }

  private async deleteApiKey(id: number) {
    this.error = '';
    try {
      await apiFetch(`/api/v1/auth/api-keys/${id}`, { method: 'DELETE' });
      this.apiKeys = await apiFetch<any[]>('/api/v1/auth/api-keys');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to delete API key';
    }
  }

  render() {
    if (this.loading) return html`<pg-loading-state label="Loading settings"></pg-loading-state>`;

    return html`
      <div class="page-title">Settings</div>

      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.success ? html`<div class="success">${this.success}</div>` : ''}

      <div class="section">
        <div class="section-title">Instance</div>
        <div class="form-grid">
          <div class="form-field">
            <span class="form-label">Instance Name</span>
            <input .value=${this.instanceName} @input=${(e: Event) => this.instanceName = (e.target as HTMLInputElement).value} placeholder="My HomeLab" />
          </div>
          <div class="form-field">
            <span class="form-label">Language</span>
            <select .value=${this.language} @change=${(e: Event) => this.language = (e.target as HTMLSelectElement).value}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click=${() => void this.saveInstance()}>Save</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Change Password</div>
        <div class="form-grid">
          <div class="form-field">
            <span class="form-label">Current Password</span>
            <input type="password" .value=${this.currentPassword} @input=${(e: Event) => this.currentPassword = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">New Password</span>
            <input type="password" .value=${this.newPassword} @input=${(e: Event) => this.newPassword = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">Confirm New Password</span>
            <input type="password" .value=${this.newPasswordConfirm} @input=${(e: Event) => this.newPasswordConfirm = (e.target as HTMLInputElement).value} />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click=${() => void this.changePassword()}>Change Password</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Notifications</div>
        <div class="form-grid">
          <div class="form-field">
            <span class="form-label">ntfy URL</span>
            <input .value=${this.ntfyUrl} @input=${(e: Event) => this.ntfyUrl = (e.target as HTMLInputElement).value} placeholder="https://ntfy.sh" />
          </div>
          <div class="form-field">
            <span class="form-label">ntfy Topic</span>
            <input .value=${this.ntfyTopic} @input=${(e: Event) => this.ntfyTopic = (e.target as HTMLInputElement).value} placeholder="my-dashboard" />
          </div>
          <div class="form-field">
            <span class="form-label">Telegram Bot Token</span>
            <input .value=${this.telegramBotToken} @input=${(e: Event) => this.telegramBotToken = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">Telegram Chat ID</span>
            <input .value=${this.telegramChatId} @input=${(e: Event) => this.telegramChatId = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">Webhook URL</span>
            <input .value=${this.webhookUrl} @input=${(e: Event) => this.webhookUrl = (e.target as HTMLInputElement).value} placeholder="https://hooks.example.com/..." />
          </div>
          <div class="form-field">
            <span class="form-label">SMTP Host</span>
            <input .value=${this.smtpHost} @input=${(e: Event) => this.smtpHost = (e.target as HTMLInputElement).value} placeholder="smtp.example.com" />
          </div>
          <div class="form-field">
            <span class="form-label">SMTP Port</span>
            <input .value=${this.smtpPort} @input=${(e: Event) => this.smtpPort = (e.target as HTMLInputElement).value} placeholder="587" />
          </div>
          <div class="form-field">
            <span class="form-label">SMTP User</span>
            <input .value=${this.smtpUser} @input=${(e: Event) => this.smtpUser = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">SMTP Password</span>
            <input type="password" .value=${this.smtpPass} @input=${(e: Event) => this.smtpPass = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">SMTP From</span>
            <input .value=${this.smtpFrom} @input=${(e: Event) => this.smtpFrom = (e.target as HTMLInputElement).value} placeholder="alerts@example.com" />
          </div>
          <div class="form-field">
            <span class="form-label">SMTP To</span>
            <input .value=${this.smtpTo} @input=${(e: Event) => this.smtpTo = (e.target as HTMLInputElement).value} placeholder="admin@example.com" />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click=${() => void this.saveNotifications()}>Save Notifications</button>
          ${this.ntfyUrl && this.ntfyTopic ? html`<button class="btn btn-outline" @click=${() => void this.testChannel('ntfy')}>Test ntfy</button>` : ''}
          ${this.telegramBotToken && this.telegramChatId ? html`<button class="btn btn-outline" @click=${() => void this.testChannel('telegram')}>Test Telegram</button>` : ''}
          ${this.webhookUrl ? html`<button class="btn btn-outline" @click=${() => void this.testChannel('webhook')}>Test Webhook</button>` : ''}
          ${this.smtpHost && this.smtpFrom && this.smtpTo ? html`<button class="btn btn-outline" @click=${() => void this.testChannel('email')}>Test Email</button>` : ''}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Theme</div>
        <div class="theme-grid">
          ${THEMES.map((theme) => html`
            <div class="theme-card ${this.currentTheme === theme.id ? 'active' : ''}" @click=${() => this.selectTheme(theme.id)}>
              <div class="theme-swatch" style="background: ${theme.color}"></div>
              <div class="theme-name">${theme.name}</div>
            </div>
          `)}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Display</div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-name">Kiosk Mode</div>
            <div class="setting-detail">Hide the sidebar for a wallboard-style display.</div>
          </div>
          <button class="toggle ${this.kioskMode ? 'active' : ''}" @click=${this.toggleKioskMode} aria-label="Toggle kiosk mode"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">API Keys</div>
        ${this.apiKeys.length === 0 ? html`<pg-empty-state title="No API keys" detail="Generate a key to query the dashboard without a browser session."></pg-empty-state>` : ''}
        ${this.apiKeys.length > 0 ? html`
          <div class="key-list">
            ${this.apiKeys.map((key: any) => html`
              <div class="key-row">
                <span class="key-name">${key.name}</span>
                <span class="key-date">${key.created_at}</span>
                <button class="delete-btn" @click=${() => void this.deleteApiKey(key.id)}>Delete</button>
              </div>
            `)}
          </div>
        ` : ''}
        <div class="add-key-form">
          <input placeholder="Key name" .value=${this.newKeyName} @input=${(e: Event) => this.newKeyName = (e.target as HTMLInputElement).value} />
          <button class="btn btn-primary" @click=${() => void this.createApiKey()}>Generate</button>
        </div>
        ${this.generatedKey ? html`<div class="key-display">Shown once: ${this.generatedKey}</div>` : ''}
      </div>
    `;
  }
}
