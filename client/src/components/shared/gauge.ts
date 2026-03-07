import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('n04h-gauge')
export class Gauge extends LitElement {
  @property({ type: Number }) value = 0;
  @property() label = '';
  @property() unit = '%';
  @property({ type: Number }) warningThreshold = 75;
  @property({ type: Number }) dangerThreshold = 90;
  @property({ type: Number }) size = 124;

  static styles = css`
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .gauge-shell {
      position: relative;
      display: grid;
      place-items: center;
      width: var(--gauge-size, var(--gauge-max-size, 124px));
      height: var(--gauge-size, var(--gauge-max-size, 124px));
      max-width: 100%;
      aspect-ratio: 1;
    }

    svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }

    .value-text {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-family: var(--font-mono);
      font-size: clamp(16px, 1.4rem, 24px);
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1;
      pointer-events: none;
    }

    .label {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 1px;
      text-align: center;
    }
  `;

  private getColor(): string {
    if (this.value >= this.dangerThreshold) return 'var(--danger)';
    if (this.value >= this.warningThreshold) return 'var(--warning)';
    return 'var(--accent)';
  }

  render() {
    const value = Math.max(0, Math.min(this.value, 100));
    const r = (this.size - 10) / 2;
    const circumference = 2 * Math.PI * r;
    const offset = circumference - (value / 100) * circumference;
    const center = this.size / 2;
    const color = this.getColor();

    return html`
      <div class="gauge-shell" style=${`--gauge-size: min(var(--gauge-max-size, ${this.size}px), ${this.size}px)`}>
        <svg viewBox="0 0 ${this.size} ${this.size}">
          <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="var(--border)" stroke-width="7"></circle>
          <circle
            cx="${center}"
            cy="${center}"
            r="${r}"
            fill="none"
            stroke="${color}"
            stroke-width="7"
            stroke-linecap="round"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            style="transition: stroke-dashoffset 0.5s ease, stroke 0.3s;"
          ></circle>
        </svg>
        <span class="value-text" style="color: ${color}">${value.toFixed(1)}${this.unit}</span>
      </div>
      ${this.label ? html`<span class="label">${this.label}</span>` : ''}
    `;
  }
}
