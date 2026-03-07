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
      width: 54px;
      height: 30px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg-primary);
      position: relative;
      cursor: pointer;
    }

    .toggle::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--text-secondary);
      transition: transform 0.2s ease, background 0.2s ease;
    }

    .toggle.active {
      background: color-mix(in srgb, var(--accent-dim) 86%, transparent);
      border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    }

    .toggle.active::after {
      transform: translateX(24px);
      background: var(--accent);
    }

    .key-list { display: grid; gap: 8px; }
    .key-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-card);
    }
    .key-name { font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); flex: 1; }
    .key-date { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

    .delete-btn {
      padding: 4px 10px;
      background: none;
      border: 1px solid var(--danger);
      border-radius: 999px;
      color: var(--danger);
      font-size: 10px;
      cursor: pointer;
      font-family: var(--font-mono);
    }

    .add-key-form { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .add-key-form input {
      flex: 1;
      min-width: 200px;
      padding: 10px 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .add-key-form button {
      padding: 10px 16px;
      background: var(--accent);
      color: var(--bg-primary);
      border: none;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
    }

    .key-display,
    .error {
      margin-top: 12px;
      padding: 12px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 11px;
      word-break: break-all;
    }

    .key-display { background: var(--success-dim); border: 1px solid color-mix(in srgb, var(--success) 26%, transparent); color: var(--success); }
    .error { background: var(--danger-dim); border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent); color: var(--danger); }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = subscribe(() => {
      const state = getState();
      this.currentTheme = state.theme;
      this.kioskMode = state.kioskMode;
    });
    void this.fetchApiKeys();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  private async fetchApiKeys() {
    this.loading = this.apiKeys.length === 0;
    this.error = '';
    try {
      this.apiKeys = await apiFetch<any[]>('/api/v1/auth/api-keys');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load API keys';
    } finally {
      this.loading = false;
    }
  }

  private selectTheme(id: string) {
    setState({ theme: id });
  }

  private toggleKioskMode() {
    setState({ kioskMode: !this.kioskMode });
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
      await this.fetchApiKeys();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create API key';
    }
  }

  private async deleteApiKey(id: number) {
    this.error = '';
    try {
      await apiFetch(`/api/v1/auth/api-keys/${id}`, { method: 'DELETE' });
      await this.fetchApiKeys();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to delete API key';
    }
  }

  render() {
    return html`
      <div class="page-title">Settings</div>

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
        ${this.loading ? html`<pg-loading-state label="Loading API keys"></pg-loading-state>` : ''}
        ${!this.loading && this.apiKeys.length === 0 ? html`<pg-empty-state title="No API keys" detail="Generate a key to query the dashboard without a browser session."></pg-empty-state>` : ''}
        ${!this.loading && this.apiKeys.length > 0 ? html`
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
          <button @click=${() => void this.createApiKey()}>Generate</button>
        </div>
        ${this.generatedKey ? html`<div class="key-display">Shown once: ${this.generatedKey}</div>` : ''}
        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      </div>
    `;
  }
}
