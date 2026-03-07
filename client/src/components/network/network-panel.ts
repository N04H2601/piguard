import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import { getState, subscribe } from '../../state/store.js';
import '../shared/card.js';
import '../shared/loading-state.js';
import '../shared/empty-state.js';

@customElement('pg-network-panel')
export class NetworkPanel extends LitElement {
  @state() private interfaces: any[] = [];
  @state() private connections: any[] = [];
  @state() private wireguard: any = null;
  @state() private arpDevices: any[] = [];
  @state() private tab: 'interfaces' | 'connections' | 'wireguard' | 'arp' = 'interfaces';
  @state() private loading = true;
  @state() private error = '';

  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  static styles = css`
    :host {
      display: block;
      padding: clamp(16px, 2vw, 28px);
      overflow-y: auto;
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
    }

    .page-title { font-family: var(--font-mono); font-size: 18px; font-weight: 600; margin-bottom: 24px; }

    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      overflow-x: auto;
    }

    .tab {
      padding: 8px 16px;
      background: none;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .tab:hover { background: var(--accent-dim); }
    .tab.active {
      background: color-mix(in srgb, var(--accent-dim) 84%, transparent);
      color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 24%, transparent);
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--bg-card) 78%, transparent);
    }

    .table {
      width: 100%;
      min-width: 720px;
      border-collapse: collapse;
    }

    .table th, .table td {
      padding: 10px 12px;
      text-align: left;
      font-family: var(--font-mono);
      font-size: 12px;
      border-bottom: 1px solid var(--border);
    }

    .table th {
      color: var(--text-muted);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 1px;
      background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
      position: sticky;
      top: 0;
    }

    .table td { color: var(--text-secondary); }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-family: var(--font-mono);
      font-weight: 600;
    }

    .status-badge.up, .status-badge.known { background: var(--success-dim); color: var(--success); }
    .status-badge.down, .status-badge.unknown { background: var(--danger-dim); color: var(--danger); }

    .peer-grid {
      display: grid;
      gap: 12px;
    }

    .peer-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px;
    }

    .peer-key { font-family: var(--font-mono); font-size: 11px; color: var(--accent); word-break: break-all; }
    .peer-detail { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-top: 4px; }

    .known-btn {
      padding: 5px 10px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-muted);
      font-size: 10px;
      cursor: pointer;
      font-family: var(--font-mono);
    }
    .known-btn:hover { border-color: var(--success); color: var(--success); }

    .error {
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
    this.unsubscribe = subscribe(() => {
      this.interfaces = getState().systemData?.network ?? [];
    });
    this.interfaces = getState().systemData?.network ?? [];
    void this.fetchData();
    this.refreshInterval = setInterval(() => void this.fetchData(), 10000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  private async fetchData() {
    this.loading = this.connections.length === 0 && this.arpDevices.length === 0 && !this.wireguard;
    this.error = '';

    try {
      const [connections, wireguard, arp] = await Promise.all([
        apiFetch<any[]>('/api/v1/network/connections'),
        apiFetch<any>('/api/v1/network/wireguard'),
        apiFetch<any>('/api/v1/network/arp'),
      ]);

      this.connections = connections;
      this.wireguard = wireguard;
      this.arpDevices = arp?.devices ?? [];
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load network data';
    } finally {
      this.loading = false;
    }
  }

  private async markKnown(mac: string) {
    try {
      await apiFetch(`/api/v1/network/arp/${mac}/known`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: '' }),
      });
      await this.fetchData();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unable to mark device as known';
    }
  }

  render() {
    return html`
      <div class="page-title">Network</div>
      <div class="tabs">
        ${(['interfaces', 'connections', 'wireguard', 'arp'] as const).map((tabName) => html`
          <button class="tab ${this.tab === tabName ? 'active' : ''}" @click=${() => this.tab = tabName}>${tabName.charAt(0).toUpperCase() + tabName.slice(1)}</button>
        `)}
      </div>

      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.loading ? html`<pg-loading-state label="Collecting network telemetry"></pg-loading-state>` : ''}
      ${!this.loading ? this.renderCurrentTab() : ''}
    `;
  }

  private renderCurrentTab() {
    switch (this.tab) {
      case 'interfaces':
        return this.renderInterfaces();
      case 'connections':
        return this.renderConnections();
      case 'wireguard':
        return this.renderWireGuard();
      case 'arp':
        return this.renderArp();
      default:
        return this.renderInterfaces();
    }
  }

  private renderInterfaces() {
    if (this.interfaces.length === 0) {
      return html`<pg-empty-state title="No interfaces" detail="Live interface data arrives through the WebSocket stream."></pg-empty-state>`;
    }

    return html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Name</th><th>RX</th><th>TX</th><th>RX Bytes</th><th>TX Bytes</th></tr></thead>
          <tbody>
            ${this.interfaces.map((iface) => html`
              <tr>
                <td style="color: var(--accent)">${iface.name}</td>
                <td>${(iface.rxRate / 1024).toFixed(1)} KB/s</td>
                <td>${(iface.txRate / 1024).toFixed(1)} KB/s</td>
                <td>${iface.rxBytes}</td>
                <td>${iface.txBytes}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderConnections() {
    if (this.connections.length === 0) {
      return html`<pg-empty-state title="No active sockets" detail="The connection table is empty or unavailable in this runtime."></pg-empty-state>`;
    }

    return html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Proto</th><th>State</th><th>Local</th><th>Remote</th><th>Process</th></tr></thead>
          <tbody>
            ${this.connections.slice(0, 100).map((connection) => html`
              <tr>
                <td>${connection.protocol}</td>
                <td>${connection.state}</td>
                <td>${connection.local}</td>
                <td>${connection.peer}</td>
                <td>${connection.process ?? ''}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderWireGuard() {
    if (!this.wireguard || Object.keys(this.wireguard).length === 0) {
      return html`<pg-empty-state title="WireGuard unavailable" detail="No WireGuard dump could be collected from the mounted environment."></pg-empty-state>`;
    }

    return html`
      <div class="peer-grid">
        ${Object.entries(this.wireguard).map(([name, iface]: [string, any]) => html`
          <pg-card cardTitle="Interface: ${name}" icon="⚿">
            <div class="peer-detail">Public Key: ${iface.publicKey}</div>
            <div class="peer-detail">Listen Port: ${iface.listenPort}</div>
            <div style="margin-top: 12px; display: grid; gap: 10px;">
              ${iface.peers.map((peer: any) => html`
                <div class="peer-card">
                  <div class="peer-key">${peer.publicKey}</div>
                  <div class="peer-detail">Endpoint: ${peer.endpoint ?? 'N/A'}</div>
                  <div class="peer-detail">Allowed IPs: ${peer.allowedIps.join(', ')}</div>
                  <div class="peer-detail">Last handshake: ${peer.latestHandshake ? new Date(peer.latestHandshake * 1000).toLocaleString() : 'Never'}</div>
                  <div class="peer-detail">Transfer: RX ${(peer.transferRx / 1048576).toFixed(1)} MB | TX ${(peer.transferTx / 1048576).toFixed(1)} MB</div>
                </div>
              `)}
            </div>
          </pg-card>
        `)}
      </div>
    `;
  }

  private renderArp() {
    if (this.arpDevices.length === 0) {
      return html`<pg-empty-state title="No ARP devices" detail="The ARP table is empty or inaccessible with the current mounts."></pg-empty-state>`;
    }

    return html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>IP</th><th>MAC</th><th>Hostname</th><th>Last Seen</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${this.arpDevices.map((device: any) => html`
              <tr>
                <td>${device.ip}</td>
                <td style="color: var(--accent)">${device.mac}</td>
                <td>${device.hostname ?? device.alias ?? '-'}</td>
                <td>${device.last_seen}</td>
                <td><span class="status-badge ${device.known ? 'known' : 'unknown'}">${device.known ? 'Known' : 'Unknown'}</span></td>
                <td>${!device.known ? html`<button class="known-btn" @click=${() => this.markKnown(device.mac)}>Mark Known</button>` : ''}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }
}
