import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch, ApiError } from '../lib/api.js';
import { EMAIL_PROVIDER_PRESETS, type EmailProvider, isValidEmailAddress } from '../lib/email-provider.js';
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from '../lib/password-policy.js';

@customElement('pg-setup-wizard')
export class SetupWizard extends LitElement {
  @state() private instanceName = 'PiGuard';
  @state() private username = 'admin';
  @state() private password = '';
  @state() private passwordConfirm = '';
  @state() private language: 'fr' | 'en' = 'fr';
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
  @state() private loading = false;
  @state() private testingEmail = false;
  @state() private error = '';
  @state() private success = '';

  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 100dvh;
      width: 100%;
      background:
        radial-gradient(circle at top left, var(--accent-glow), transparent 28%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 84%, transparent), var(--bg-primary));
      padding: clamp(16px, 3vw, 24px);
      box-sizing: border-box;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }

    .shell {
      width: min(100%, 980px);
      margin: 0 auto;
      background: color-mix(in srgb, var(--bg-card) 94%, transparent);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: var(--shadow-card), var(--shadow-glow);
      backdrop-filter: blur(20px);
      overflow: hidden;
    }

    .hero {
      display: grid;
      gap: 10px;
      padding: 28px 30px 20px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, color-mix(in srgb, var(--accent-dim) 40%, transparent), transparent);
    }

    .eyebrow {
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--accent);
    }

    h1 {
      font-size: clamp(26px, 4vw, 38px);
      line-height: 1.05;
      margin: 0;
    }

    .sub {
      color: var(--text-secondary);
      max-width: 72ch;
    }

    .content {
      display: grid;
      gap: 18px;
      padding: 24px 30px 30px;
      box-sizing: border-box;
    }

    .panel {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .section {
      display: grid;
      gap: 12px;
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: color-mix(in srgb, var(--bg-secondary) 62%, transparent);
    }

    .section-title {
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .grid.one {
      grid-template-columns: 1fr;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--text-secondary);
      min-width: 0;
    }

    input,
    select {
      width: 100%;
      padding: 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-primary);
      font: inherit;
      box-sizing: border-box;
    }

    .hint,
    .link-row {
      font-size: 11px;
      color: var(--text-muted);
    }

    .link-row a {
      color: var(--accent);
      text-decoration: none;
    }

    .link-row a:hover {
      text-decoration: underline;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-card) 88%, transparent);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .toggle-btn,
    .secondary-btn,
    .submit {
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      font-family: var(--font-mono);
      font-size: 11px;
      cursor: pointer;
    }

    .toggle-btn,
    .secondary-btn {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-secondary);
    }

    .actions {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
      padding-top: 6px;
    }

    .action-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .submit {
      background: var(--accent);
      color: var(--bg-primary);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      width: 100%;
    }

    .submit:disabled,
    .secondary-btn:disabled,
    .toggle-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .error,
    .success {
      padding: 12px 14px;
      border-radius: 14px;
      font-size: 12px;
    }

    .error {
      background: var(--danger-dim);
      color: var(--danger);
    }

    .success {
      background: var(--success-dim);
      color: var(--success);
    }

    @media (max-width: 900px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      :host {
        padding: 12px;
      }

      .shell {
        border-radius: 18px;
      }

      .hero {
        padding: 20px 18px 16px;
      }

      .content {
        gap: 16px;
        padding: 16px 18px 20px;
      }

      .section {
        padding: 14px;
      }
    }
  `;

  private setEmailProvider(provider: EmailProvider) {
    const preset = EMAIL_PROVIDER_PRESETS[provider];
    this.emailProvider = provider;
    this.smtpHost = preset.host;
    this.smtpPort = preset.port;
    this.smtpTls = preset.tls;
    this.emailAdvanced = provider === 'custom';
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

  private async handleSubmit(event: Event) {
    event.preventDefault();
    this.error = '';
    this.success = '';

    const passwordError = getPasswordPolicyError(this.password);
    if (passwordError) {
      this.error = passwordError;
      return;
    }

    if (this.password !== this.passwordConfirm) {
      this.error = 'Passwords do not match.';
      return;
    }

    const notificationError = this.validateNotifications();
    if (notificationError) {
      this.error = notificationError;
      return;
    }

    this.loading = true;

    try {
      const data = await apiFetch<{ username: string; setupComplete: boolean }>('/api/v1/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.username.trim(),
          password: this.password,
          language: this.language,
          instanceName: this.instanceName.trim() || 'PiGuard',
          notifications: this.buildNotificationPayload(),
        }),
      });

      this.dispatchEvent(new CustomEvent('setup-success', {
        detail: data,
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : 'Setup failed';
    } finally {
      this.loading = false;
    }
  }

  private async testEmail() {
    this.error = '';
    this.success = '';

    const notificationError = this.validateNotifications();
    if (notificationError) {
      this.error = notificationError;
      return;
    }

    this.testingEmail = true;
    try {
      const data = await apiFetch<{ message?: string }>('/api/v1/auth/setup/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: this.buildNotificationPayload() }),
      });
      this.success = data.message ?? `Test email sent to ${this.smtpTo.trim()}`;
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : 'Failed to send test email';
    } finally {
      this.testingEmail = false;
    }
  }

  private renderEmailSection() {
    const providerLabel = this.emailProvider === 'gmail' ? 'Gmail' : this.emailProvider === 'outlook' ? 'Outlook' : 'Custom';
    const passwordLabel = this.emailProvider === 'gmail' ? 'Mot de passe d’application' : 'Mot de passe';

    return html`
      <div class="section">
        <div class="section-title">Email Alerts</div>
        <div class="grid one">
          <label>
            Email Provider
            <select .value=${this.emailProvider} @change=${(event: Event) => this.setEmailProvider((event.target as HTMLSelectElement).value as EmailProvider)}>
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>

        ${this.emailProvider === 'custom' ? this.renderCustomEmailFields() : html`
          <div class="grid">
            <label>
              Adresse ${providerLabel}
              <input
                type="email"
                .value=${this.smtpUser}
                @input=${(event: Event) => { this.smtpUser = (event.target as HTMLInputElement).value; }}
                placeholder=${this.emailProvider === 'gmail' ? 'name@gmail.com' : 'name@outlook.com'}
              />
            </label>
            <label>
              ${passwordLabel}
              <input
                type="password"
                .value=${this.smtpPass}
                @input=${(event: Event) => { this.smtpPass = (event.target as HTMLInputElement).value; }}
              />
            </label>
            <label class="grid one" style="grid-column: 1 / -1;">
              Email destinataire
              <input
                type="email"
                .value=${this.smtpTo}
                @input=${(event: Event) => { this.smtpTo = (event.target as HTMLInputElement).value; }}
                placeholder="alerts@example.com"
              />
            </label>
          </div>
          ${this.emailProvider === 'gmail' ? html`
            <div class="link-row">
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Comment creer un mot de passe d’application ?</a>
            </div>
          ` : ''}
          <div class="toggle-row">
            <span>Configuration avancee</span>
            <button class="toggle-btn" type="button" @click=${() => { this.emailAdvanced = !this.emailAdvanced; }}>
              ${this.emailAdvanced ? 'Masquer' : 'Afficher'}
            </button>
          </div>
          ${this.emailAdvanced ? this.renderAdvancedEmailFields() : ''}
        `}

        <div class="action-row">
          <button class="secondary-btn" type="button" @click=${() => void this.testEmail()} ?disabled=${this.testingEmail}>
            ${this.testingEmail ? 'Envoi…' : 'Envoyer un test'}
          </button>
        </div>
      </div>
    `;
  }

  private renderAdvancedEmailFields() {
    return html`
      <div class="grid">
        <label>
          SMTP Host
          <input .value=${this.smtpHost} @input=${(event: Event) => { this.smtpHost = (event.target as HTMLInputElement).value; }} />
        </label>
        <label>
          Port
          <input .value=${this.smtpPort} @input=${(event: Event) => { this.smtpPort = (event.target as HTMLInputElement).value; }} />
        </label>
        <label>
          TLS
          <select .value=${this.smtpTls ? 'true' : 'false'} @change=${(event: Event) => { this.smtpTls = (event.target as HTMLSelectElement).value === 'true'; }}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>
          From address
          <input type="email" .value=${this.smtpFrom} @input=${(event: Event) => { this.smtpFrom = (event.target as HTMLInputElement).value; }} placeholder="alerts@example.com" />
        </label>
      </div>
    `;
  }

  private renderCustomEmailFields() {
    return html`
      <div class="grid">
        <label>
          SMTP Host
          <input .value=${this.smtpHost} @input=${(event: Event) => { this.smtpHost = (event.target as HTMLInputElement).value; }} placeholder="smtp.example.com" />
        </label>
        <label>
          Port
          <input .value=${this.smtpPort} @input=${(event: Event) => { this.smtpPort = (event.target as HTMLInputElement).value; }} placeholder="587" />
        </label>
        <label>
          TLS
          <select .value=${this.smtpTls ? 'true' : 'false'} @change=${(event: Event) => { this.smtpTls = (event.target as HTMLSelectElement).value === 'true'; }}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>
          Username
          <input .value=${this.smtpUser} @input=${(event: Event) => { this.smtpUser = (event.target as HTMLInputElement).value; }} />
        </label>
        <label>
          Password
          <input type="password" .value=${this.smtpPass} @input=${(event: Event) => { this.smtpPass = (event.target as HTMLInputElement).value; }} />
        </label>
        <label>
          From address
          <input type="email" .value=${this.smtpFrom} @input=${(event: Event) => { this.smtpFrom = (event.target as HTMLInputElement).value; }} placeholder="alerts@example.com" />
        </label>
        <label style="grid-column: 1 / -1;">
          Email destinataire
          <input type="email" .value=${this.smtpTo} @input=${(event: Event) => { this.smtpTo = (event.target as HTMLInputElement).value; }} placeholder="alerts@example.com" />
        </label>
      </div>
    `;
  }

  render() {
    return html`
      <div class="shell">
        <div class="hero">
          <div class="eyebrow">First Run Setup</div>
          <h1>Deploy first, configure from the browser.</h1>
          <div class="sub">
            This wizard stores the admin account and notification settings inside the dashboard database.
            Health checks can be added later from the app once the instance is online.
          </div>
        </div>

        <form class="content" @submit=${this.handleSubmit}>
          <div class="panel">
            <div class="section">
              <div class="section-title">Instance</div>
              <div class="grid one">
                <label>
                  Instance Name
                  <input placeholder="My HomeLab" .value=${this.instanceName} @input=${(event: Event) => { this.instanceName = (event.target as HTMLInputElement).value; }} />
                </label>
              </div>
              <div class="hint">Displayed in the sidebar, login page, and browser tab title.</div>
            </div>

            <div class="section">
              <div class="section-title">Admin Access</div>
              <div class="grid">
                <label>
                  Username
                  <input .value=${this.username} @input=${(event: Event) => { this.username = (event.target as HTMLInputElement).value; }} required />
                </label>
                <label>
                  Language
                  <select .value=${this.language} @change=${(event: Event) => { this.language = (event.target as HTMLSelectElement).value as 'fr' | 'en'; }}>
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  Password
                  <input type="password" .value=${this.password} @input=${(event: Event) => { this.password = (event.target as HTMLInputElement).value; }} required />
                </label>
                <label>
                  Confirm password
                  <input type="password" .value=${this.passwordConfirm} @input=${(event: Event) => { this.passwordConfirm = (event.target as HTMLInputElement).value; }} required />
                </label>
              </div>
              <div class="hint">${PASSWORD_POLICY_HINT} The selected language is stored for future UI defaults.</div>
            </div>

            <div class="section">
              <div class="section-title">Telegram Alerts</div>
              <div class="grid">
                <label>
                  Telegram Bot Token
                  <input .value=${this.telegramBotToken} @input=${(event: Event) => { this.telegramBotToken = (event.target as HTMLInputElement).value; }} />
                </label>
                <label>
                  Telegram Chat ID
                  <input .value=${this.telegramChatId} @input=${(event: Event) => { this.telegramChatId = (event.target as HTMLInputElement).value; }} />
                </label>
              </div>
            </div>

            ${this.renderEmailSection()}

            ${this.error ? html`<div class="error">${this.error}</div>` : ''}
            ${this.success ? html`<div class="success">${this.success}</div>` : ''}

            <div class="actions">
              <div class="hint">You can change notification settings later from Settings > Notifications.</div>
              <button class="submit" type="submit" ?disabled=${this.loading}>${this.loading ? 'Applying setup…' : 'Finish setup'}</button>
            </div>
          </div>
        </form>
      </div>
    `;
  }
}
