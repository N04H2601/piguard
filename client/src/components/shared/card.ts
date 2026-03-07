import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('pg-card')
export class Card extends LitElement {
  @property() cardTitle = '';
  @property() icon = '';
  @property() status: 'normal' | 'warning' | 'danger' = 'normal';

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .card {
      background: color-mix(in srgb, var(--bg-card) 92%, transparent);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 20px;
      backdrop-filter: blur(12px);
      box-shadow: var(--shadow-card);
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
      height: 100%;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 10px;
      min-width: 0;
      overflow: hidden;
    }

    .card:hover {
      border-color: var(--border-active);
      box-shadow: var(--shadow-card), var(--shadow-glow);
      transform: translateY(-1px);
    }

    .card.warning {
      border-color: color-mix(in srgb, var(--warning) 30%, transparent);
    }

    .card.danger {
      border-color: color-mix(in srgb, var(--danger) 30%, transparent);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      min-width: 0;
    }

    .card-icon {
      font-size: 14px;
      color: var(--accent);
    }

    .card-title {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 1.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card-body {
      min-height: 0;
      min-width: 0;
    }
  `;

  render() {
    return html`
      <div class="card ${this.status}">
        ${this.cardTitle ? html`
          <div class="card-header">
            ${this.icon ? html`<span class="card-icon">${this.icon}</span>` : ''}
            <span class="card-title">${this.cardTitle}</span>
          </div>
        ` : ''}
        <div class="card-body">
          <slot></slot>
        </div>
      </div>
    `;
  }
}
