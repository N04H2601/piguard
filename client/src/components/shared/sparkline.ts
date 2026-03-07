import { LitElement, html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('n04h-sparkline')
export class Sparkline extends LitElement {
  @property({ type: Array }) values: number[] = [];
  @property({ type: Number }) width = 240;
  @property({ type: Number }) height = 72;
  @property() color = 'var(--accent)';
  @property() fill = 'var(--accent-dim)';

  static styles = css`
    :host {
      display: block;
    }

    svg {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }

    .grid line {
      stroke: color-mix(in srgb, var(--text-muted) 14%, transparent);
      stroke-width: 1;
    }
  `;

  render() {
    if (this.values.length < 2) {
      return html``;
    }

    const points = this.buildPoints();
    const areaPoints = `${points} ${this.width},${this.height} 0,${this.height}`;

    return html`
      <svg viewBox="0 0 ${this.width} ${this.height}" preserveAspectRatio="none" aria-hidden="true">
        <g class="grid">
          <line x1="0" y1="0" x2="${this.width}" y2="0"></line>
          <line x1="0" y1="${this.height / 2}" x2="${this.width}" y2="${this.height / 2}"></line>
          <line x1="0" y1="${this.height}" x2="${this.width}" y2="${this.height}"></line>
        </g>
        <polygon points="${areaPoints}" fill="${this.fill}"></polygon>
        ${svg`<polyline points="${points}" fill="none" stroke="${this.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>`}
      </svg>
    `;
  }

  private buildPoints(): string {
    const max = Math.max(...this.values);
    const min = Math.min(...this.values);
    const range = max - min || 1;

    return this.values
      .map((value, index) => {
        const x = (index / (this.values.length - 1)) * this.width;
        const y = this.height - ((value - min) / range) * (this.height - 8) - 4;
        return `${x},${y}`;
      })
      .join(' ');
  }
}
