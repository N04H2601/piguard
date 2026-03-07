import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('pg-loading-state')
export class LoadingState extends LitElement {
  @property() label = 'Loading';

  static styles = css`
    :host {
      display: block;
      padding: 32px 20px;
    }

    .wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      min-height: 140px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid color-mix(in srgb, var(--accent) 18%, transparent);
      border-top-color: var(--accent);
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  render() {
    return html`<div class="wrap"><span class="spinner"></span><span>${this.label}</span></div>`;
  }
}
