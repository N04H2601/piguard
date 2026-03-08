import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch, ApiError } from '../../lib/api.js';
import { getState, setState, subscribe } from '../../state/store.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from '../../lib/password-policy.js';
import { EMAIL_PROVIDER_PRESETS, inferEmailProvider, type EmailProvider, isValidEmailAddress } from '../../lib/email-provider.js';

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

  @state() private instanceName = '';
  @state() private language = 'fr';

  @state() private currentPassword = '';
  @state() private newPassword = '';
  @state() private newPasswordConfirm = '';

  @state() private telegramBotToken = '';
  @state() private telegramChatId = '';
  @state() private emailProvider: EmailProvider = 'gmail';
  @state() private emailAdvanced = false;
  @state() private smtpHost = EMAIL_PROVIDER_PRESETS.gmail.host;
  @state() private smtpPort = EMAIL_PROVIDER_PRESETS.gmail.port;
  @state() private smtpTls = EMAIL_PROVIDER_PRESETS.gmail.tls;
  @state() private smtpUser = '';
  @state() private smtpPass = '';
  @state() private smtpFrom = '';
  @state() private smtpTo = '';
  @state() private testingEmail = false;
  @state() private testingTelegram = false;
  @state() private openaiApiKey = '';
  @state() private openaiModel = 'gpt-5.4';
  @state() private aiConfigured = false;

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

    .panel-card {
      padding: 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }

    .stack { display: grid; gap: 12px; }

    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .form-grid.one { grid-template-columns: 1fr; }
    .form-field { display: grid; gap: 6px; min-width: 0; }
    .form-label { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; }
    .form-hint { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
    .link-hint a { color: var(--accent); text-decoration: none; }
    .link-hint a:hover { text-decoration: underline; }

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
      const [instance, notifications, ai, keys] = await Promise.all([
        apiFetch<{ instanceName: string; language: string }>('/api/v1/settings/instance'),
        apiFetch<any>('/api/v1/settings/notifications'),
        apiFetch<{ openaiApiKey: string; openaiModel: string; configured: boolean }>('/api/v1/settings/ai'),
        apiFetch<any[]>('/api/v1/auth/api-keys'),
      ]);

      this.instanceName = instance.instanceName ?? 'PiGuard';
      this.language = instance.language ?? 'fr';
      this.telegramBotToken = notifications.telegramBotToken ?? '';
      this.telegramChatId = notifications.telegramChatId ?? '';

      const provider = (notifications.smtpProvider as EmailProvider | undefined)
        ?? inferEmailProvider(notifications.smtpHost ?? '');
      this.emailProvider = provider;
      this.emailAdvanced = provider === 'custom';
      this.smtpHost = notifications.smtpHost ?? EMAIL_PROVIDER_PRESETS[provider].host;
      this.smtpPort = notifications.smtpPort ?? EMAIL_PROVIDER_PRESETS[provider].port;
      this.smtpTls = typeof notifications.smtpTls === 'boolean' ? notifications.smtpTls : EMAIL_PROVIDER_PRESETS[provider].tls;
      this.smtpUser = notifications.smtpUser ?? '';
      this.smtpPass = notifications.smtpPass ?? '';
      this.smtpFrom = notifications.smtpFrom ?? '';
      this.smtpTo = notifications.smtpTo ?? '';
      this.openaiApiKey = ai.openaiApiKey ?? '';
      this.openaiModel = ai.openaiModel ?? 'gpt-5.4';
      this.aiConfigured = Boolean(ai.configured);
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

  private setEmailProvider(provider: EmailProvider) {
    const preset = EMAIL_PROVIDER_PRESETS[provider];
    this.emailProvider = provider;
    this.smtpHost = preset.host;
    this.smtpPort = preset.port;
    this.smtpTls = preset.tls;
    this.emailAdvanced = provider === 'custom';
    if (provider !== 'custom' && this.smtpFrom.trim() === '') {
      this.smtpFrom = this.smtpUser.trim();
    }
  }

  private buildNotificationPayload() {
    const telegramBotToken = this.telegramBotToken.trim();
    const telegramChatId = this.telegramChatId.trim();
    const emailConfigured = Boolean(
      this.smtpTo.trim()
      || this.smtpUser.trim()
      || this.smtpPass.trim()
      || this.smtpFrom.trim()
    );

    if (!emailConfigured) {
      return {
        telegramBotToken,
        telegramChatId,
        smtpProvider: this.emailProvider,
        smtpHost: '',
        smtpPort: '',
        smtpUser: '',
        smtpPass: '',
        smtpFrom: '',
        smtpTo: '',
        smtpTls: this.smtpTls,
      };
    }

    const smtpUser = this.smtpUser.trim();
    const smtpFrom = (this.emailProvider === 'custom' || this.emailAdvanced)
      ? this.smtpFrom.trim()
      : (this.smtpFrom.trim() || smtpUser);

    return {
      telegramBotToken,
      telegramChatId,
      smtpProvider: this.emailProvider,
      smtpHost: this.smtpHost.trim(),
      smtpPort: this.smtpPort.trim(),
      smtpUser,
      smtpPass: this.smtpPass,
      smtpFrom,
      smtpTo: this.smtpTo.trim(),
      smtpTls: this.smtpTls,
    };
  }

  private validateNotifications() {
    const telegramBotToken = this.telegramBotToken.trim();
    const telegramChatId = this.telegramChatId.trim();
    if (Boolean(telegramBotToken) !== Boolean(telegramChatId)) {
      return 'Telegram bot token and chat ID must be provided together.';
    }

    const payload = this.buildNotificationPayload();
    const emailConfigured = Boolean(
      payload.smtpTo
      || payload.smtpUser
      || payload.smtpPass
      || payload.smtpFrom
    );

    if (!emailConfigured) {
      return null;
    }

    if (!payload.smtpTo || !isValidEmailAddress(payload.smtpTo)) {
      return 'Enter a valid recipient email address.';
    }

    if (this.emailProvider !== 'custom') {
      if (!payload.smtpUser || !isValidEmailAddress(payload.smtpUser)) {
        return `Enter a valid ${this.emailProvider === 'gmail' ? 'Gmail' : 'Outlook'} address.`;
      }
      if (!payload.smtpPass) {
        return this.emailProvider === 'gmail'
          ? 'Gmail app password is required.'
          : 'Outlook password is required.';
      }
    } else {
      if (!payload.smtpHost) return 'SMTP host is required.';
      if (!payload.smtpPort) return 'SMTP port is required.';
      if (!payload.smtpFrom || !isValidEmailAddress(payload.smtpFrom)) {
        return 'Enter a valid From address.';
      }
    }

    if ((this.emailProvider !== 'custom' || this.emailAdvanced) && payload.smtpFrom && !isValidEmailAddress(payload.smtpFrom)) {
      return 'Enter a valid From address.';
    }

    return null;
  }

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
    const passwordError = getPasswordPolicyError(this.newPassword);
    if (passwordError) { this.error = passwordError; return; }
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
    const notificationError = this.validateNotifications();
    if (notificationError) {
      this.error = notificationError;
      return;
    }

    try {
      await apiFetch('/api/v1/settings/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildNotificationPayload()),
      });
      this.showSuccess('Notification settings saved.');
      await this.loadAll();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save notifications';
    }
  }

  private async saveAiSettings() {
    this.error = '';
    try {
      await apiFetch('/api/v1/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openaiApiKey: this.openaiApiKey,
          openaiModel: this.openaiModel,
        }),
      });
      window.dispatchEvent(new CustomEvent('piguard-ai-settings-updated'));
      this.showSuccess('AI settings saved.');
      await this.loadAll();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save AI settings';
    }
  }

  private async testChannel(channel: 'telegram' | 'email') {
    this.error = '';
    this.success = '';

    if (channel === 'email') {
      const notificationError = this.validateNotifications();
      if (notificationError) {
        this.error = notificationError;
        return;
      }
      this.testingEmail = true;
    } else {
      if (Boolean(this.telegramBotToken.trim()) !== Boolean(this.telegramChatId.trim())) {
        this.error = 'Telegram bot token and chat ID must be provided together.';
        return;
      }
      this.testingTelegram = true;
    }

    try {
      const data = await apiFetch<{ message?: string }>('/api/v1/settings/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channel === 'email'
          ? { channel, ...this.buildNotificationPayload() }
          : { channel }),
      });
      this.showSuccess(data.message ?? `Test ${channel} notification sent.`);
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : `Failed to send test ${channel} notification`;
    } finally {
      this.testingEmail = false;
      this.testingTelegram = false;
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

  private renderEmailAdvancedFields() {
    return html`
      <div class="form-grid">
        <div class="form-field">
          <span class="form-label">SMTP Host</span>
          <input .value=${this.smtpHost} @input=${(e: Event) => this.smtpHost = (e.target as HTMLInputElement).value} placeholder="smtp.example.com" />
        </div>
        <div class="form-field">
          <span class="form-label">Port</span>
          <input .value=${this.smtpPort} @input=${(e: Event) => this.smtpPort = (e.target as HTMLInputElement).value} placeholder="587" />
        </div>
        <div class="form-field">
          <span class="form-label">TLS</span>
          <select .value=${this.smtpTls ? 'true' : 'false'} @change=${(e: Event) => this.smtpTls = (e.target as HTMLSelectElement).value === 'true'}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
        <div class="form-field">
          <span class="form-label">From Address</span>
          <input type="email" .value=${this.smtpFrom} @input=${(e: Event) => this.smtpFrom = (e.target as HTMLInputElement).value} placeholder="alerts@example.com" />
        </div>
      </div>
    `;
  }

  private renderEmailNotifications() {
    const providerLabel = this.emailProvider === 'gmail' ? 'Gmail' : this.emailProvider === 'outlook' ? 'Outlook' : 'Custom';
    const passwordLabel = this.emailProvider === 'gmail' ? 'Mot de passe d’application' : 'Mot de passe';

    return html`
      <div class="panel-card stack">
        <div class="form-grid">
          <div class="form-field">
            <span class="form-label">Telegram Bot Token</span>
            <input .value=${this.telegramBotToken} @input=${(e: Event) => this.telegramBotToken = (e.target as HTMLInputElement).value} />
          </div>
          <div class="form-field">
            <span class="form-label">Telegram Chat ID</span>
            <input .value=${this.telegramChatId} @input=${(e: Event) => this.telegramChatId = (e.target as HTMLInputElement).value} />
          </div>
        </div>

        <div class="form-actions">
          ${this.telegramBotToken && this.telegramChatId ? html`
            <button class="btn btn-outline" @click=${() => void this.testChannel('telegram')} ?disabled=${this.testingTelegram}>
              ${this.testingTelegram ? 'Sending...' : 'Test Telegram'}
            </button>
          ` : ''}
        </div>

        <div class="form-grid one">
          <div class="form-field">
            <span class="form-label">Email Provider</span>
            <select .value=${this.emailProvider} @change=${(e: Event) => this.setEmailProvider((e.target as HTMLSelectElement).value as EmailProvider)}>
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        ${this.emailProvider === 'custom' ? html`
          <div class="form-grid">
            <div class="form-field">
              <span class="form-label">SMTP Host</span>
              <input .value=${this.smtpHost} @input=${(e: Event) => this.smtpHost = (e.target as HTMLInputElement).value} placeholder="smtp.example.com" />
            </div>
            <div class="form-field">
              <span class="form-label">Port</span>
              <input .value=${this.smtpPort} @input=${(e: Event) => this.smtpPort = (e.target as HTMLInputElement).value} placeholder="587" />
            </div>
            <div class="form-field">
              <span class="form-label">TLS</span>
              <select .value=${this.smtpTls ? 'true' : 'false'} @change=${(e: Event) => this.smtpTls = (e.target as HTMLSelectElement).value === 'true'}>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div class="form-field">
              <span class="form-label">Username</span>
              <input .value=${this.smtpUser} @input=${(e: Event) => this.smtpUser = (e.target as HTMLInputElement).value} />
            </div>
            <div class="form-field">
              <span class="form-label">Password</span>
              <input type="password" .value=${this.smtpPass} @input=${(e: Event) => this.smtpPass = (e.target as HTMLInputElement).value} />
            </div>
            <div class="form-field">
              <span class="form-label">From Address</span>
              <input type="email" .value=${this.smtpFrom} @input=${(e: Event) => this.smtpFrom = (e.target as HTMLInputElement).value} placeholder="alerts@example.com" />
            </div>
            <div class="form-field">
              <span class="form-label">Email destinataire</span>
              <input type="email" .value=${this.smtpTo} @input=${(e: Event) => this.smtpTo = (e.target as HTMLInputElement).value} placeholder="alerts@example.com" />
            </div>
          </div>
        ` : html`
          <div class="form-grid">
            <div class="form-field">
              <span class="form-label">Adresse ${providerLabel}</span>
              <input
                type="email"
                .value=${this.smtpUser}
                @input=${(e: Event) => this.smtpUser = (e.target as HTMLInputElement).value}
                placeholder=${this.emailProvider === 'gmail' ? 'name@gmail.com' : 'name@outlook.com'}
              />
            </div>
            <div class="form-field">
              <span class="form-label">${passwordLabel}</span>
              <input type="password" .value=${this.smtpPass} @input=${(e: Event) => this.smtpPass = (e.target as HTMLInputElement).value} />
            </div>
            <div class="form-field">
              <span class="form-label">Email destinataire</span>
              <input type="email" .value=${this.smtpTo} @input=${(e: Event) => this.smtpTo = (e.target as HTMLInputElement).value} placeholder="alerts@example.com" />
            </div>
          </div>

          ${this.emailProvider === 'gmail' ? html`
            <div class="form-hint link-hint">
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Comment creer un mot de passe d’application ?</a>
            </div>
          ` : ''}

          <div class="setting-row">
            <div class="setting-copy">
              <div class="setting-name">Configuration avancee</div>
              <div class="setting-detail">Affiche les champs host, port, TLS et from pour ajuster le preset.</div>
            </div>
            <button class="btn btn-outline" @click=${() => { this.emailAdvanced = !this.emailAdvanced; }}>
              ${this.emailAdvanced ? 'Hide' : 'Show'}
            </button>
          </div>

          ${this.emailAdvanced ? this.renderEmailAdvancedFields() : ''}
        `}

        <div class="form-actions">
          <button class="btn btn-primary" @click=${() => void this.saveNotifications()}>Save Notifications</button>
          <button class="btn btn-outline" @click=${() => void this.testChannel('email')} ?disabled=${this.testingEmail}>
            ${this.testingEmail ? 'Sending...' : 'Envoyer un test'}
          </button>
        </div>
      </div>
    `;
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
        <div class="form-actions">
          <span class="form-label">${PASSWORD_POLICY_HINT}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Notifications</div>
        ${this.renderEmailNotifications()}
      </div>

      <div class="section">
        <div class="section-title">AI</div>
        <div class="panel-card stack">
          <div class="form-grid">
            <div class="form-field">
              <span class="form-label">OpenAI API Key</span>
              <input
                type="password"
                .value=${this.openaiApiKey}
                @input=${(e: Event) => this.openaiApiKey = (e.target as HTMLInputElement).value}
                placeholder="sk-..."
              />
              <span class="form-hint">Required to use the AI panel. Leave blank to disable it.</span>
            </div>
            <div class="form-field">
              <span class="form-label">Model</span>
              <input
                .value=${this.openaiModel}
                @input=${(e: Event) => this.openaiModel = (e.target as HTMLInputElement).value}
                placeholder="gpt-5.4"
              />
              <span class="form-hint">${this.aiConfigured ? 'AI is currently configured.' : 'AI is currently disabled until a token is saved.'}</span>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" @click=${() => void this.saveAiSettings()}>Save AI</button>
          </div>
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
