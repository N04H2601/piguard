import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getState, setState, subscribe } from '../state/store.js';
import { connectWs, disconnectWs } from '../state/ws-client.js';
import { apiFetch, setAuthExpiredHandler } from '../lib/api.js';
import { startSummarySync, stopSummarySync } from '../state/data-sync.js';

import './login-page.js';
import './setup-wizard.js';
import './sidebar.js';
import './dashboard/overview.js';
import './docker/docker-panel.js';
import './network/network-panel.js';
import './health/health-panel.js';
import './security/security-panel.js';
import './nginx/nginx-panel.js';
import './alerts/alerts-panel.js';
import './nodes/nodes-panel.js';
import './shared/settings-panel.js';
import './assistant/ai-assistant.js';

@customElement('piguard-app')
export class AppShell extends LitElement {
  @state() private authenticated = false;
  @state() private setupChecked = false;
  @state() private setupComplete = true;
  @state() private currentRoute = 'dashboard';
  @state() private sidebarCollapsed = false;
  @state() private mobileSidebarOpen = false;
  @state() private kioskMode = false;
  @state() private systemData: any = null;
  @state() private wsConnected = false;
  @state() private activeAlerts = 0;
  @state() private servicesDown = 0;
  @state() private instanceName = 'PiGuard';
  @state() private authError: string | null = null;

  private unsubscribe: (() => void) | null = null;
  private readonly hashChangeHandler = () => this.handleRoute();

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100dvh;
    }

    .app-layout {
      display: flex;
      height: 100dvh;
      width: 100%;
      background:
        radial-gradient(circle at top right, var(--accent-glow), transparent 32%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 82%, transparent), var(--bg-primary));
    }

    .main-content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-secondary) 84%, transparent);
      backdrop-filter: blur(18px);
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .topbar-title {
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }

    .menu-btn {
      background: none;
      border: none;
      color: var(--text-primary);
      font-size: 20px;
      cursor: pointer;
      padding: 4px 8px;
    }

    .pill {
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      cursor: pointer;
    }

    .pill.online {
      color: var(--success);
      border-color: color-mix(in srgb, var(--success) 30%, var(--border));
    }

    .content {
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    .mobile-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(3, 6, 16, 0.6);
      backdrop-filter: blur(4px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 80;
    }

    .mobile-backdrop.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .kiosk-exit {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 120;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 11px;
      cursor: pointer;
      backdrop-filter: blur(18px);
    }

    @media (min-width: 1025px) {
      .menu-btn {
        display: none;
      }
    }

    @media (max-width: 1024px) {
      .topbar {
        padding: 12px 14px;
      }
    }

    @media (max-width: 768px) {
      .pill {
        display: none;
      }
    }
  `;

  async connectedCallback() {
    super.connectedCallback();

    this.unsubscribe = subscribe(() => this.syncFromStore());
    this.syncFromStore();

    setAuthExpiredHandler(() => {
      disconnectWs();
      stopSummarySync();
    });

    await this.checkAuth();

    window.addEventListener('hashchange', this.hashChangeHandler);
    this.handleRoute();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    setAuthExpiredHandler(null);
    window.removeEventListener('hashchange', this.hashChangeHandler);
    disconnectWs();
    stopSummarySync();
  }

  private syncFromStore() {
    const currentState = getState();
    this.authenticated = currentState.authenticated;
    this.currentRoute = currentState.currentRoute;
    this.systemData = currentState.systemData;
    this.wsConnected = currentState.wsConnected;
    this.activeAlerts = currentState.activeAlerts;
    this.servicesDown = currentState.servicesDown;
    this.mobileSidebarOpen = currentState.mobileSidebarOpen;
    this.kioskMode = currentState.kioskMode;
    this.instanceName = currentState.instanceName;
    this.authError = currentState.authError;
    document.title = this.instanceName || 'PiGuard';
  }

  private async checkAuth() {
    try {
      const setup = await apiFetch<{ complete: boolean }>('/api/v1/auth/setup-status', { suppressUnauthorized: true });
      this.setupComplete = setup.complete;
      this.setupChecked = true;
      if (!setup.complete) {
        setState({ authenticated: false, username: '', authError: null, wsConnected: false });
        return;
      }
    } catch {
      this.setupComplete = true;
      this.setupChecked = true;
    }

    try {
      const data = await apiFetch<{ username: string; instanceName?: string }>('/api/v1/auth/me', { suppressUnauthorized: true });
      if (data.username) {
        setState({ authenticated: true, username: data.username, instanceName: data.instanceName || 'PiGuard', authError: null });
        connectWs();
        startSummarySync();
      }
    } catch {
      // Not authenticated.
    }
  }

  private handleRoute() {
    const hash = window.location.hash.replace('#/', '') || 'dashboard';
    setState({ currentRoute: hash });
  }

  private onLoginSuccess() {
    setState({ authenticated: true, authError: null });
    connectWs();
    startSummarySync();
  }

  private onSetupSuccess() {
    this.setupComplete = true;
    setState({ authenticated: true, authError: null });
    connectWs();
    startSummarySync();
  }

  private async onLogout() {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST', suppressUnauthorized: true });
    } catch {
      // Ignore logout failures and clear local state anyway.
    }

    setState({ authenticated: false, username: '', mobileSidebarOpen: false });
    disconnectWs();
    stopSummarySync();
  }

  private onNavigate(e: CustomEvent) {
    const route = e.detail;
    window.location.hash = `#/${route}`;
    if (window.innerWidth <= 1024) {
      setState({ mobileSidebarOpen: false });
    }
  }

  private toggleSidebar() {
    if (window.innerWidth <= 1024) {
      setState({ mobileSidebarOpen: !this.mobileSidebarOpen });
      return;
    }
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  private toggleKioskMode() {
    setState({ kioskMode: !this.kioskMode, mobileSidebarOpen: false });
  }

  render() {
    if (!this.setupChecked) {
      return html``;
    }

    if (!this.setupComplete) {
      return html`<pg-setup-wizard @setup-success=${() => this.onSetupSuccess()}></pg-setup-wizard>`;
    }

    if (!this.authenticated) {
      return html`<pg-login .errorMessage=${this.authError ?? ''} .instanceName=${this.instanceName} @login-success=${() => this.onLoginSuccess()}></pg-login>`;
    }

    return html`
      <div class="mobile-backdrop ${this.mobileSidebarOpen ? 'visible' : ''}" @click=${() => setState({ mobileSidebarOpen: false })}></div>
      <div class="app-layout">
        ${!this.kioskMode ? html`
          <pg-sidebar
            .currentRoute=${this.currentRoute}
            .instanceName=${this.instanceName}
            ?collapsed=${this.sidebarCollapsed}
            ?mobile-open=${this.mobileSidebarOpen}
            .activeAlerts=${this.activeAlerts}
            .servicesDown=${this.servicesDown}
            .wsConnected=${this.wsConnected}
            @navigate=${this.onNavigate}
            @toggle-sidebar=${this.toggleSidebar}
            @logout=${this.onLogout}
          ></pg-sidebar>
        ` : ''}

        <div class="main-content">
          <div class="topbar">
            <div class="topbar-actions">
              <button class="menu-btn" @click=${this.toggleSidebar}>☰</button>
              <span class="topbar-title">${this.currentRoute}</span>
            </div>
            <div class="topbar-actions">
              <button class="pill ${this.wsConnected ? 'online' : ''}" @click=${this.toggleKioskMode}>
                ${this.kioskMode ? 'Exit kiosk' : 'Kiosk mode'}
              </button>
            </div>
          </div>
          <div class="content">
            ${this.renderPage()}
          </div>
        </div>
      </div>
      ${this.kioskMode ? html`<button class="kiosk-exit" @click=${this.toggleKioskMode}>Exit Kiosk</button>` : ''}
      <pg-ai-assistant></pg-ai-assistant>
    `;
  }

  private renderPage() {
    switch (this.currentRoute) {
      case 'dashboard':
        return html`<pg-overview .data=${this.systemData}></pg-overview>`;
      case 'docker':
        return html`<pg-docker-panel></pg-docker-panel>`;
      case 'network':
        return html`<pg-network-panel></pg-network-panel>`;
      case 'health':
        return html`<pg-health-panel></pg-health-panel>`;
      case 'security':
        return html`<pg-security-panel></pg-security-panel>`;
      case 'nginx':
        return html`<pg-nginx-panel></pg-nginx-panel>`;
      case 'alerts':
        return html`<pg-alerts-panel></pg-alerts-panel>`;
      case 'nodes':
        return html`<pg-nodes-panel></pg-nodes-panel>`;
      case 'settings':
        return html`<pg-settings-panel></pg-settings-panel>`;
      default:
        return html`<pg-overview .data=${this.systemData}></pg-overview>`;
    }
  }
}
