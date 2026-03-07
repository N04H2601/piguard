import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';
import '../shared/loading-state.js';

@customElement('n04h-nodes-panel')
export class NodesPanel extends LitElement {
  @state() private nodes: any[] = [];
  @state() private loading = true;

  static styles = css`
    :host { display: block; padding: clamp(16px, 2vw, 28px); overflow-y: auto; height: 100%; min-height: 0; box-sizing: border-box; }
    .page-title { font-family: var(--font-mono); font-size: 18px; font-weight: 600; margin-bottom: 24px; }

    .node-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 20px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .node-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .node-dot.online { background: var(--success); box-shadow: 0 0 10px var(--success); }
    .node-dot.offline { background: var(--danger); }

    .node-name { font-family: var(--font-mono); font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .node-type { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); padding: 2px 8px; background: var(--accent-dim); border-radius: 999px; }

    .stub-notice {
      margin-top: 24px;
      padding: 16px;
      background: var(--accent-dim);
      border: 1px solid var(--border-active);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.fetchNodes();
  }

  private async fetchNodes() {
    try {
      this.nodes = await apiFetch<any[]>('/api/v1/nodes');
    } catch {
      this.nodes = [];
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (this.loading) {
      return html`<n04h-loading-state label="Loading nodes"></n04h-loading-state>`;
    }

    return html`
      <div class="page-title">Nodes</div>
      ${this.nodes.map((node) => html`
        <div class="node-card">
          <div class="node-dot ${node.status}"></div>
          <div><div class="node-name">${node.name}</div></div>
          <span class="node-type">${node.type}</span>
        </div>
      `)}
      <div class="stub-notice">Multi-node monitoring remains local-only for now. This panel is ready for agent-based nodes when the backend grows beyond the single Raspberry Pi target.</div>
    `;
  }
}
