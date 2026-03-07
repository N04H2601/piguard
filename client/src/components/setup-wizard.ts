import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch, ApiError } from '../lib/api.js';

type CheckType = 'http' | 'tcp' | 'dns' | 'icmp';

interface SetupCheck {
  name: string;
  type: CheckType;
  target: string;
  interval_s: number;
}

@customElement('pg-setup-wizard')
export class SetupWizard extends LitElement {
  @state() private instanceName = 'PiGuard';
  @state() private username = 'admin';
  @state() private password = '';
  @state() private passwordConfirm = '';
  @state() private language: 'fr' | 'en' = 'fr';
  @state() private ntfyUrl = '';
  @state() private ntfyTopic = '';
  @state() private telegramBotToken = '';
  @state() private telegramChatId = '';
  @state() private webhookUrl = '';
  @state() private checks: SetupCheck[] = [];
  @state() private loading = false;
  @state() private error = '';

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100dvh;
      width: 100%;
      background:
        radial-gradient(circle at top left, var(--accent-glow), transparent 28%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 84%, transparent), var(--bg-primary));
      padding: 24px;
      box-sizing: border-box;
      overflow: auto;
    }

    .shell {
      width: min(100%, 980px);
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
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px;
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

    .hint {
      font-size: 11px;
      color: var(--text-muted);
    }

    .checks {
      display: grid;
      gap: 10px;
    }

    .check-row {
      display: grid;
      grid-template-columns: 1.1fr 0.7fr 1.6fr 110px 40px;
      gap: 8px;
      align-items: end;
    }

    .mini-btn,
    .submit {
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      font-family: var(--font-mono);
      font-size: 11px;
      cursor: pointer;
    }

    .mini-btn {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-secondary);
    }

    .remove {
      width: 40px;
      height: 40px;
      padding: 0;
      border-radius: 12px;
      background: var(--danger-dim);
      color: var(--danger);
      border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent);
    }

    .actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-top: 6px;
    }

    .submit {
      background: var(--accent);
      color: var(--bg-primary);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      min-width: 180px;
    }

    .submit:disabled,
    .mini-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .error {
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--danger-dim);
      color: var(--danger);
      font-size: 12px;
    }

    @media (max-width: 900px) {
      .content,
      .grid,
      .check-row {
        grid-template-columns: 1fr;
      }

      .actions {
        flex-direction: column;
        align-items: stretch;
      }

      .submit {
        width: 100%;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.checks = [
      { name: 'Dashboard API', type: 'http', target: `${window.location.origin}/api/v1/health`, interval_s: 60 },
      { name: 'Main Site', type: 'http', target: '', interval_s: 60 },
    ];
  }

  private addCheck() {
    this.checks = [...this.checks, { name: '', type: 'http', target: '', interval_s: 60 }];
  }

  private updateCheck(index: number, patch: Partial<SetupCheck>) {
    this.checks = this.checks.map((check, checkIndex) => checkIndex === index ? { ...check, ...patch } : check);
  }

  private removeCheck(index: number) {
    this.checks = this.checks.filter((_, checkIndex) => checkIndex !== index);
  }

  private async handleSubmit(event: Event) {
    event.preventDefault();
    this.error = '';

    if (this.password.length < 10) {
      this.error = 'Password must be at least 10 characters.';
      return;
    }

    if (this.password !== this.passwordConfirm) {
      this.error = 'Passwords do not match.';
      return;
    }

    const validChecks = this.checks
      .map((check) => ({ ...check, name: check.name.trim(), target: check.target.trim() }))
      .filter((check) => check.name && check.target);

    if (validChecks.length === 0) {
      this.error = 'Configure at least one health check.';
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
          healthChecks: validChecks,
          notifications: {
            ntfyUrl: this.ntfyUrl.trim(),
            ntfyTopic: this.ntfyTopic.trim(),
            telegramBotToken: this.telegramBotToken.trim(),
            telegramChatId: this.telegramChatId.trim(),
            webhookUrl: this.webhookUrl.trim(),
          },
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

  render() {
    return html`
      <div class="shell">
        <div class="hero">
          <div class="eyebrow">First Run Setup</div>
          <h1>Deploy first, configure from the browser.</h1>
          <div class="sub">
            This wizard stores the admin account, initial health checks and notification endpoints inside the dashboard database.
            After this step, the instance is ready without editing application credentials in the container environment.
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
              <div class="hint">The selected language is stored for future UI and assistant defaults.</div>
            </div>

            <div class="section">
              <div class="section-title">Notifications</div>
              <div class="grid one">
                <label>
                  ntfy URL
                  <input placeholder="https://ntfy.sh" .value=${this.ntfyUrl} @input=${(event: Event) => { this.ntfyUrl = (event.target as HTMLInputElement).value; }} />
                </label>
                <label>
                  ntfy Topic
                  <input placeholder="my-dashboard" .value=${this.ntfyTopic} @input=${(event: Event) => { this.ntfyTopic = (event.target as HTMLInputElement).value; }} />
                </label>
                <label>
                  Telegram Bot Token
                  <input .value=${this.telegramBotToken} @input=${(event: Event) => { this.telegramBotToken = (event.target as HTMLInputElement).value; }} />
                </label>
                <label>
                  Telegram Chat ID
                  <input .value=${this.telegramChatId} @input=${(event: Event) => { this.telegramChatId = (event.target as HTMLInputElement).value; }} />
                </label>
                <label>
                  Webhook URL
                  <input placeholder="https://hooks.example.com/..." .value=${this.webhookUrl} @input=${(event: Event) => { this.webhookUrl = (event.target as HTMLInputElement).value; }} />
                </label>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="section">
              <div class="section-title">Health Checks</div>
              <div class="checks">
                ${this.checks.map((check, index) => html`
                  <div class="check-row">
                    <label>
                      Name
                      <input .value=${check.name} @input=${(event: Event) => this.updateCheck(index, { name: (event.target as HTMLInputElement).value })} />
                    </label>
                    <label>
                      Type
                      <select .value=${check.type} @change=${(event: Event) => this.updateCheck(index, { type: (event.target as HTMLSelectElement).value as CheckType })}>
                        <option value="http">HTTP</option>
                        <option value="tcp">TCP</option>
                        <option value="dns">DNS</option>
                        <option value="icmp">ICMP</option>
                      </select>
                    </label>
                    <label>
                      Target
                      <input .value=${check.target} @input=${(event: Event) => this.updateCheck(index, { target: (event.target as HTMLInputElement).value })} />
                    </label>
                    <label>
                      Interval (s)
                      <input type="number" min="15" .value=${String(check.interval_s)} @input=${(event: Event) => this.updateCheck(index, { interval_s: Number((event.target as HTMLInputElement).value || '60') })} />
                    </label>
                    <button type="button" class="remove" ?disabled=${this.checks.length <= 1} @click=${() => this.removeCheck(index)}>×</button>
                  </div>
                `)}
              </div>
              <button type="button" class="mini-btn" @click=${this.addCheck}>Add check</button>
              <div class="hint">Use HTTP for websites and APIs, TCP for host:port, DNS for domain resolution, ICMP for simple reachability.</div>
            </div>

            ${this.error ? html`<div class="error">${this.error}</div>` : ''}

            <div class="actions">
              <div class="hint">Only Docker-level variables such as PORT, TZ and mounted volumes should stay in the container environment.</div>
              <button class="submit" type="submit" ?disabled=${this.loading}>${this.loading ? 'Applying setup…' : 'Finish setup'}</button>
            </div>
          </div>
        </form>
      </div>
    `;
  }
}
