import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ensureCsrfToken } from '../lib/api.js';

@customElement('n04h-login')
export class LoginPage extends LitElement {
  @property() errorMessage = '';
  @state() private username = '';
  @state() private password = '';
  @state() private error = '';
  @state() private loading = false;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      width: 100%;
      background:
        radial-gradient(circle at top left, var(--accent-glow), transparent 28%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 84%, transparent), var(--bg-primary));
      position: relative;
      overflow: hidden;
    }

    canvas {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      opacity: 0.15;
      pointer-events: none;
    }

    .login-card {
      position: relative;
      z-index: 1;
      width: min(100%, 440px);
      margin: 20px;
      padding: 48px 40px;
      background: color-mix(in srgb, var(--bg-card) 92%, transparent);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      backdrop-filter: blur(20px);
      box-shadow: var(--shadow-card), var(--shadow-glow);
    }

    .logo {
      text-align: center;
      margin-bottom: 40px;
    }

    .logo-text {
      font-family: var(--font-mono);
      font-size: clamp(32px, 7vw, 40px);
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 6px;
      text-shadow: 0 0 30px var(--accent-dim);
    }

    .logo-sub {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      letter-spacing: 3px;
      margin-top: 8px;
      text-transform: uppercase;
    }

    .field {
      margin-bottom: 20px;
    }

    label {
      display: block;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .prompt {
      position: absolute;
      left: 14px;
      font-family: var(--font-mono);
      font-size: 14px;
      color: var(--accent);
      pointer-events: none;
      opacity: 0.7;
    }

    input {
      width: 100%;
      padding: 12px 14px 12px 36px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-dim);
    }

    input::placeholder {
      color: var(--text-muted);
    }

    button {
      width: 100%;
      padding: 12px;
      margin-top: 8px;
      background: var(--accent);
      color: var(--bg-primary);
      border: none;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }

    button:hover { opacity: 0.9; }
    button:active { transform: scale(0.98); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    .error {
      margin-top: 16px;
      padding: 10px 14px;
      background: var(--danger-dim);
      border: 1px solid color-mix(in srgb, var(--danger) 32%, transparent);
      border-radius: var(--radius-sm);
      color: var(--danger);
      font-family: var(--font-mono);
      font-size: 12px;
      text-align: center;
    }
  `;

  firstUpdated() {
    this.startMatrixRain();
  }

  willUpdate() {
    if (this.errorMessage && !this.error) {
      this.error = this.errorMessage;
    }
  }

  private startMatrixRain() {
    const canvas = this.shadowRoot!.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const chars = 'PIGUARDABCDEF0123456789><{}[]|/\\';
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);
    const drops = new Array(columns).fill(1);

    const draw = () => {
      ctx.fillStyle = 'rgba(10, 10, 15, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const style = getComputedStyle(document.documentElement);
      const accent = style.getPropertyValue('--accent').trim() || '#00f0ff';
      ctx.fillStyle = accent;
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(char ?? '0', i * fontSize, drops[i]! * fontSize);

        if (drops[i]! * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]!++;
      }

      requestAnimationFrame(draw);
    };
    draw();
  }

  private async handleSubmit(e: Event) {
    e.preventDefault();
    this.error = '';
    this.loading = true;

    try {
      const csrfToken = await ensureCsrfToken();
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ username: this.username, password: this.password }),
        credentials: 'include',
      });

      const data = await res.json();

      if (data.success) {
        this.dispatchEvent(new CustomEvent('login-success', { bubbles: true, composed: true }));
      } else {
        this.error = data.error || 'Invalid credentials';
      }
    } catch {
      this.error = 'Connection failed';
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <canvas></canvas>
      <div class="login-card">
        <div class="logo">
          <div class="logo-text">PiGuard</div>
          <div class="logo-sub">monitoring dashboard</div>
        </div>
        <form @submit=${this.handleSubmit}>
          <div class="field">
            <label>Username</label>
            <div class="input-wrapper">
              <span class="prompt">&gt;_</span>
              <input
                type="text"
                placeholder="admin"
                .value=${this.username}
                @input=${(e: Event) => this.username = (e.target as HTMLInputElement).value}
                autocomplete="username"
                required
              />
            </div>
          </div>
          <div class="field">
            <label>Password</label>
            <div class="input-wrapper">
              <span class="prompt">&gt;_</span>
              <input
                type="password"
                placeholder="password"
                .value=${this.password}
                @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value}
                autocomplete="current-password"
                required
              />
            </div>
          </div>
          <button type="submit" ?disabled=${this.loading}>
            ${this.loading ? 'Authenticating...' : 'Login'}
          </button>
          ${this.error ? html`<div class="error">${this.error}</div>` : ''}
        </form>
      </div>
    `;
  }
}
