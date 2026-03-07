import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('pg-empty-state')
export class EmptyState extends LitElement {
  @property() title = 'No data';
  @property() detail = '';

  static styles = css`
    :host {
      display: block;
      padding: 24px;
    }

    .wrap {
      display: grid;
      gap: 8px;
      place-items: center;
      min-height: 150px;
      border: 1px dashed color-mix(in srgb, var(--accent) 18%, var(--border));
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--bg-card) 70%, transparent);
      text-align: center;
      padding: 28px;
    }

    .title {
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }

    .detail {
      max-width: 34ch;
      color: var(--text-muted);
      font-size: 13px;
    }
  `;

  render() {
    return html`
      <div class="wrap">
        <div class="title">${this.title}</div>
        ${this.detail ? html`<div class="detail">${this.detail}</div>` : ''}
      </div>
    `;
  }
}
