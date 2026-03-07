import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

interface NavItem {
  id: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '■' },
  { id: 'docker', label: 'Docker', icon: '▦' },
  { id: 'network', label: 'Network', icon: '◈' },
  { id: 'health', label: 'Health Checks', icon: '♥' },
  { id: 'security', label: 'Security', icon: '⚠' },
  { id: 'nginx', label: 'Nginx', icon: '▷' },
  { id: 'alerts', label: 'Alerts', icon: '⚡' },
  { id: 'nodes', label: 'Nodes', icon: '⊕' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

@customElement('n04h-sidebar')
export class Sidebar extends LitElement {
  @property() currentRoute = 'dashboard';
  @property({ type: Boolean }) collapsed = false;
  @property({ type: Boolean, attribute: 'mobile-open' }) mobileOpen = false;
  @property({ type: Number }) activeAlerts = 0;
  @property({ type: Number }) servicesDown = 0;
  @property({ type: Boolean }) wsConnected = false;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: var(--sidebar-width);
      height: 100vh;
      background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
      border-right: 1px solid var(--border);
      transition: width 0.25s ease, transform 0.25s ease;
      flex-shrink: 0;
      overflow: hidden;
      backdrop-filter: blur(20px);
      z-index: 90;
    }

    :host([collapsed]) {
      width: var(--sidebar-collapsed);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 16px;
      border-bottom: 1px solid var(--border);
      min-height: 68px;
    }

    .logo {
      font-family: var(--font-mono);
      font-size: 20px;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.28em;
      white-space: nowrap;
      overflow: hidden;
    }

    :host([collapsed]) .logo {
      font-size: 14px;
      letter-spacing: 0.1em;
    }

    .collapse-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
      display: flex;
      transition: color 0.2s;
    }

    .collapse-btn:hover { color: var(--text-primary); }

    nav {
      flex: 1;
      padding: 14px 10px;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      margin-bottom: 4px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease, color 0.15s ease;
      color: var(--text-secondary);
      text-decoration: none;
      white-space: nowrap;
      position: relative;
    }

    .nav-item:hover {
      background: var(--accent-dim);
      color: var(--text-primary);
      transform: translateX(2px);
    }

    .nav-item.active {
      background: color-mix(in srgb, var(--accent-dim) 82%, transparent);
      color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
    }

    .nav-icon {
      font-size: 16px;
      width: 24px;
      text-align: center;
      flex-shrink: 0;
    }

    .nav-label {
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    :host([collapsed]) .nav-label {
      display: none;
    }

    .badge {
      margin-left: auto;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .badge-danger {
      background: var(--danger-dim);
      color: var(--danger);
    }

    .badge-warning {
      background: var(--warning-dim);
      color: var(--warning);
    }

    :host([collapsed]) .badge {
      display: none;
    }

    .footer {
      padding: 14px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.online { background: var(--success); box-shadow: 0 0 6px var(--success); }
    .status-dot.offline { background: var(--danger); }

    .status-text {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    :host([collapsed]) .status-text {
      display: none;
    }

    .logout-btn {
      margin-left: auto;
      background: none;
      border: 1px solid var(--border);
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      transition: all 0.2s;
      font-family: var(--font-mono);
    }

    .logout-btn:hover {
      background: var(--danger-dim);
      border-color: color-mix(in srgb, var(--danger) 30%, transparent);
      color: var(--danger);
    }

    :host([collapsed]) .logout-btn {
      display: none;
    }

    @media (max-width: 1024px) {
      :host {
        position: fixed;
        inset: 0 auto 0 0;
        transform: translateX(-100%);
        width: min(82vw, 320px);
      }

      :host([mobile-open]) {
        transform: translateX(0);
      }
    }
  `;

  private navigate(route: string) {
    this.dispatchEvent(new CustomEvent('navigate', { detail: route, bubbles: true, composed: true }));
  }

  private toggleCollapse() {
    this.dispatchEvent(new CustomEvent('toggle-sidebar', { bubbles: true, composed: true }));
  }

  private logout() {
    this.dispatchEvent(new CustomEvent('logout', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="header">
        <span class="logo">PiGuard</span>
        <button class="collapse-btn" @click=${this.toggleCollapse} title="Toggle sidebar">◀</button>
      </div>

      <nav>
        ${NAV_ITEMS.map((item) => html`
          <div class="nav-item ${this.currentRoute === item.id ? 'active' : ''}" @click=${() => this.navigate(item.id)}>
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-label">${item.label}</span>
            ${item.id === 'alerts' && this.activeAlerts > 0 ? html`<span class="badge badge-danger">${this.activeAlerts}</span>` : ''}
            ${item.id === 'health' && this.servicesDown > 0 ? html`<span class="badge badge-warning">${this.servicesDown}</span>` : ''}
          </div>
        `)}
      </nav>

      <div class="footer">
        <div class="status-dot ${this.wsConnected ? 'online' : 'offline'}"></div>
        <span class="status-text">${this.wsConnected ? 'Connected' : 'Disconnected'}</span>
        <button class="logout-btn" @click=${this.logout}>Logout</button>
      </div>
    `;
  }
}
