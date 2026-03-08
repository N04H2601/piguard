import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiFetch } from '../../lib/api.js';

interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  archived?: number | boolean;
  archived_at?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  user_message_count?: number;
}

interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

const GUIDED_ACTIONS = [
  'Que dois-je corriger en priorité maintenant ?',
  'Analyse les services en panne et les checks de santé.',
  'Résume les risques sécurité observés sur le dashboard.',
  'Analyse la pression CPU, RAM, disque et réseau.',
];

function renderInlineMarkdown(text: string): Array<string | TemplateResult> {
  const output: Array<string | TemplateResult> = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      output.push(text.slice(cursor, match.index));
    }

    if (match[2] !== undefined) {
      output.push(html`<strong>${match[2]}</strong>`);
    } else if (match[3] !== undefined) {
      output.push(html`<code>${match[3]}</code>`);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    output.push(text.slice(cursor));
  }

  return output;
}

function renderMarkdown(markdown: string): TemplateResult[] {
  const blocks: TemplateResult[] = [];
  const lines = markdown.replace(/\r/g, '').split('\n');
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(html`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) return;
    const items = listItems.map((item) => html`<li>${renderInlineMarkdown(item)}</li>`);
    blocks.push(listType === 'ul' ? html`<ul>${items}</ul>` : html`<ol>${items}</ol>`);
    listType = null;
    listItems = [];
  };

  const pushHeading = (level: number, value: string) => {
    const content = renderInlineMarkdown(value.trim());
    if (level <= 1) {
      blocks.push(html`<h1>${content}</h1>`);
    } else if (level === 2) {
      blocks.push(html`<h2>${content}</h2>`);
    } else {
      blocks.push(html`<h3>${content}</h3>`);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      pushHeading(headingMatch[1].length, headingMatch[2]);
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType === 'ol') flushList();
      listType = 'ul';
      listItems.push(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType === 'ul') flushList();
      listType = 'ol';
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.length ? blocks : [html`<p>${renderInlineMarkdown(markdown)}</p>`];
}

@customElement('pg-ai-assistant')
export class AiAssistant extends LitElement {
  @state() private open = false;
  @state() private configured = false;
  @state() private model = '';
  @state() private archiveView: 'active' | 'archived' = 'active';
  @state() private loadingBootstrap = true;
  @state() private loadingMessages = false;
  @state() private creatingConversation = false;
  @state() private mutatingConversation = false;
  @state() private sending = false;
  @state() private prompt = '';
  @state() private error = '';
  @state() private conversations: Conversation[] = [];
  @state() private activeConversationId: number | null = null;
  @state() private messages: ChatMessage[] = [];

  private readonly handleDocumentPointerDown = (event: PointerEvent) => {
    if (!this.open) return;
    const path = event.composedPath();
    if (!path.includes(this)) {
      this.open = false;
    }
  };

  private readonly handleAiSettingsUpdated = () => {
    void this.bootstrap();
  };

  static styles = css`
    :host {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 130;
      font-family: var(--font-sans);
      box-sizing: border-box;
    }

    .launcher {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
      background:
        radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--accent) 32%, transparent), transparent 55%),
        color-mix(in srgb, var(--bg-secondary) 90%, transparent);
      color: var(--text-primary);
      box-shadow: var(--shadow-card), var(--shadow-glow);
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.08em;
      backdrop-filter: blur(18px);
    }

    .panel {
      position: absolute;
      right: 0;
      bottom: 76px;
      width: min(780px, calc(100vw - 28px));
      height: min(680px, calc(100dvh - 118px));
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      grid-template-rows: auto 1fr;
      border: 1px solid var(--border);
      border-radius: 22px;
      overflow: hidden;
      background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
      box-shadow: var(--shadow-card), var(--shadow-glow);
      backdrop-filter: blur(20px);
      box-sizing: border-box;
    }

    .header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-card) 84%, transparent);
      box-sizing: border-box;
    }

    .title {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .name {
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-primary);
    }

    .sub {
      color: var(--text-muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .status {
      padding: 5px 8px;
      border-radius: 999px;
      font-family: var(--font-mono);
      font-size: 10px;
      text-transform: uppercase;
      border: 1px solid var(--border);
      white-space: nowrap;
    }

    .status.ready {
      color: var(--success);
      border-color: color-mix(in srgb, var(--success) 28%, transparent);
      background: var(--success-dim);
    }

    .status.off {
      color: var(--warning);
      border-color: color-mix(in srgb, var(--warning) 28%, transparent);
      background: var(--warning-dim);
    }

    .sidebar {
      min-width: 0;
      min-height: 0;
      border-right: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-card) 80%, transparent);
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      box-sizing: border-box;
    }

    .sidebar-top,
    .sidebar-filters {
      padding: 14px;
      box-sizing: border-box;
    }

    .sidebar-top,
    .sidebar-filters {
      display: grid;
      gap: 10px;
      border-bottom: 1px solid var(--border);
    }

    .sidebar-label,
    .guided-title {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .filter-row,
    .guided-list,
    .chat-meta-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .new-button,
    .chip,
    .send,
    .view-button,
    .meta-button {
      border-radius: 999px;
      font-family: var(--font-mono);
      font-size: 11px;
      cursor: pointer;
      transition: border-color 0.2s ease, transform 0.2s ease, background 0.2s ease;
      box-sizing: border-box;
    }

    .new-button,
    .chip,
    .view-button,
    .meta-button {
      padding: 8px 12px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-secondary);
    }

    .view-button.active {
      background: color-mix(in srgb, var(--accent-dim) 70%, transparent);
      border-color: color-mix(in srgb, var(--accent) 24%, transparent);
      color: var(--accent);
    }

    .meta-button.warn {
      color: var(--warning);
      border-color: color-mix(in srgb, var(--warning) 25%, transparent);
    }

    .meta-button.danger {
      color: var(--danger);
      border-color: color-mix(in srgb, var(--danger) 25%, transparent);
    }

    .new-button:hover,
    .chip:hover,
    .send:hover:not(:disabled),
    .view-button:hover,
    .meta-button:hover {
      transform: translateY(-1px);
    }

    .conversation-list {
      overflow-y: auto;
      padding: 10px;
      display: grid;
      gap: 8px;
      align-content: start;
      min-height: 0;
      box-sizing: border-box;
    }

    .conversation-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      min-width: 0;
    }

    .conversation-item {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      min-width: 0;
      box-sizing: border-box;
    }

    .conversation-item:hover {
      background: color-mix(in srgb, var(--accent-dim) 40%, transparent);
      border-color: color-mix(in srgb, var(--accent) 18%, transparent);
    }

    .conversation-item.active {
      background: color-mix(in srgb, var(--accent-dim) 68%, transparent);
      border-color: color-mix(in srgb, var(--accent) 24%, transparent);
    }

    .conversation-title,
    .conversation-preview,
    .message {
      overflow-wrap: anywhere;
      min-width: 0;
    }

    .conversation-title {
      font-size: 12px;
      color: var(--text-primary);
      font-weight: 600;
    }

    .conversation-preview {
      font-size: 11px;
      color: var(--text-muted);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }

    .conversation-dismiss {
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-muted);
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1;
      flex-shrink: 0;
    }

    .conversation-dismiss:hover {
      border-color: color-mix(in srgb, var(--warning) 28%, transparent);
      color: var(--warning);
      transform: translateY(-1px);
    }

    .conversation-dismiss.danger:hover {
      border-color: color-mix(in srgb, var(--danger) 28%, transparent);
      color: var(--danger);
    }

    .conversation-dismiss:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }

    .chat-shell {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto 1fr auto;
      box-sizing: border-box;
    }

    .chat-meta {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      color: var(--text-muted);
      min-width: 0;
      box-sizing: border-box;
    }

    .chat-meta-main {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .chat-meta strong {
      color: var(--text-secondary);
      font-weight: 600;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .messages {
      overflow-y: auto;
      min-height: 0;
      padding: 16px;
      display: grid;
      gap: 12px;
      align-content: start;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 90%, transparent), transparent 25%),
        color-mix(in srgb, var(--bg-secondary) 72%, transparent);
      box-sizing: border-box;
    }

    .message {
      max-width: min(100%, 92%);
      padding: 12px 14px;
      border-radius: 16px;
      line-height: 1.55;
      font-size: 13px;
      border: 1px solid var(--border);
      box-sizing: border-box;
    }

    .message.user {
      justify-self: end;
      background: color-mix(in srgb, var(--accent-dim) 76%, transparent);
      border-color: color-mix(in srgb, var(--accent) 22%, transparent);
      color: var(--text-primary);
    }

    .message.assistant {
      justify-self: start;
      background: color-mix(in srgb, var(--bg-card) 92%, transparent);
      color: var(--text-secondary);
    }

    .message-body {
      display: grid;
      gap: 10px;
    }

    .message-body p,
    .message-body ul,
    .message-body ol,
    .message-body h1,
    .message-body h2,
    .message-body h3 {
      margin: 0;
    }

    .message-body ul,
    .message-body ol {
      padding-left: 18px;
    }

    .message-body li + li {
      margin-top: 6px;
    }

    .message-body h1,
    .message-body h2,
    .message-body h3 {
      font-family: var(--font-mono);
      color: var(--text-primary);
      letter-spacing: 0.04em;
    }

    .message-body h1 { font-size: 15px; }
    .message-body h2 { font-size: 14px; }
    .message-body h3 { font-size: 13px; }

    .message-body code {
      padding: 1px 5px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
      border: 1px solid var(--border);
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .guided {
      display: grid;
      gap: 10px;
      padding: 2px 0 8px;
    }

    .loading,
    .empty,
    .error {
      padding: 12px 14px;
      font-size: 12px;
      border-bottom: 1px solid var(--border);
      overflow-wrap: anywhere;
      box-sizing: border-box;
    }

    .loading,
    .empty {
      color: var(--text-secondary);
      background: color-mix(in srgb, var(--bg-card) 86%, transparent);
    }

    .error {
      color: var(--danger);
      background: var(--danger-dim);
    }

    .composer {
      display: grid;
      gap: 8px;
      padding: 14px 16px 16px;
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-card) 92%, transparent);
      box-sizing: border-box;
    }

    textarea {
      width: 100%;
      min-height: 86px;
      max-height: 180px;
      resize: vertical;
      padding: 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 14px;
      color: var(--text-primary);
      font: inherit;
      overflow-wrap: anywhere;
      box-sizing: border-box;
    }

    .actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .hint {
      font-size: 11px;
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }

    .send {
      padding: 10px 14px;
      border: none;
      background: var(--accent);
      color: var(--bg-primary);
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    .send:disabled,
    .new-button:disabled,
    .chip:disabled,
    .view-button:disabled,
    .meta-button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }

    @media (max-width: 900px) {
      .panel {
        width: min(100vw - 18px, 760px);
        height: min(82dvh, 760px);
        grid-template-columns: 1fr;
        grid-template-rows: auto auto 1fr;
      }

      .sidebar {
        border-right: none;
        border-bottom: 1px solid var(--border);
        max-height: 240px;
      }

      .conversation-list {
        grid-auto-flow: column;
        grid-auto-columns: minmax(220px, 1fr);
        overflow-x: auto;
        overflow-y: hidden;
      }
    }

    @media (max-width: 720px) {
      :host {
        right: 12px;
        bottom: 12px;
      }

      .panel {
        width: min(100vw - 12px, 100vw);
        height: min(84dvh, 820px);
        bottom: 70px;
      }

      .header,
      .chat-meta,
      .composer,
      .sidebar-top,
      .sidebar-filters,
      .sidebar-note {
        padding-left: 14px;
        padding-right: 14px;
      }

      .messages {
        padding: 14px;
      }

      .message {
        max-width: 100%;
      }

      .actions,
      .chat-meta {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;

  async connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    window.addEventListener('piguard-ai-settings-updated', this.handleAiSettingsUpdated as EventListener);
    await this.bootstrap();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    window.removeEventListener('piguard-ai-settings-updated', this.handleAiSettingsUpdated as EventListener);
  }

  private get activeConversationTitle() {
    return this.conversations.find((conversation) => conversation.id === this.activeConversationId)?.title ?? 'Conversation';
  }

  private get showGuidedActions() {
    return this.configured && this.activeConversationId !== null && !this.messages.some((message) => message.role === 'user');
  }

  private get showComposer() {
    return this.configured && this.activeConversationId !== null;
  }

  private get inactiveAssistantMessage() {
    return 'Ajoute ton token OpenAI dans Settings > AI avant d’utiliser l’assistant.';
  }

  private async bootstrap() {
    this.loadingBootstrap = true;
    this.error = '';

    try {
      const status = await apiFetch<{ configured: boolean; model: string }>('/api/v1/ai/status');
      this.configured = status.configured;
      this.model = status.model;
      await this.refreshConversations();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Assistant IA indisponible';
    } finally {
      this.loadingBootstrap = false;
    }
  }

  private async refreshConversations(preferredConversationId?: number) {
    const archived = this.archiveView === 'archived' ? 1 : 0;
    const conversations = await apiFetch<Conversation[]>(`/api/v1/ai/conversations?archived=${archived}`);
    this.conversations = conversations;

    if (conversations.length === 0) {
      this.activeConversationId = null;
      this.messages = [];
      return;
    }

    const targetId = conversations.some((conversation) => conversation.id === preferredConversationId)
      ? preferredConversationId
      : this.activeConversationId && conversations.some((conversation) => conversation.id === this.activeConversationId)
        ? this.activeConversationId
        : conversations[0].id;

    if (targetId !== null && targetId !== undefined) {
      await this.loadConversation(targetId);
    }
  }

  private async setArchiveView(view: 'active' | 'archived') {
    if (this.archiveView === view) return;
    this.archiveView = view;
    this.activeConversationId = null;
    this.messages = [];
    await this.refreshConversations();
  }

  private async createConversation() {
    if (this.creatingConversation) return;
    if (!this.configured) {
      this.error = this.inactiveAssistantMessage;
      return;
    }

    this.creatingConversation = true;
    this.error = '';

    try {
      this.archiveView = 'active';
      const data = await apiFetch<{ conversation: Conversation; messages: ChatMessage[] }>('/api/v1/ai/conversations', {
        method: 'POST',
      });
      await this.refreshConversations(data.conversation.id);
      this.messages = data.messages;
      this.activeConversationId = data.conversation.id;
      this.prompt = '';
      await this.scrollMessagesToBottom();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Impossible de créer une conversation';
    } finally {
      this.creatingConversation = false;
    }
  }

  private async loadConversation(conversationId: number) {
    this.loadingMessages = true;
    this.error = '';

    try {
      const data = await apiFetch<{ conversation: Conversation; messages: ChatMessage[] }>(`/api/v1/ai/conversations/${conversationId}/messages`);
      this.activeConversationId = data.conversation.id;
      this.messages = data.messages;
      await this.scrollMessagesToBottom();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Impossible de charger la conversation';
    } finally {
      this.loadingMessages = false;
    }
  }

  private async archiveConversation(archived: boolean) {
    const conversationId = this.activeConversationId;
    if (!conversationId || this.mutatingConversation) return;

    this.mutatingConversation = true;
    this.error = '';

    try {
      await apiFetch(`/api/v1/ai/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });

      if (archived) {
        await this.refreshConversations();
      } else {
        this.archiveView = 'active';
        await this.refreshConversations(conversationId);
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Impossible de mettre à jour la conversation';
    } finally {
      this.mutatingConversation = false;
    }
  }

  private async archiveConversationById(conversation: Conversation) {
    if (this.mutatingConversation) return;
    if ((conversation.user_message_count ?? 0) === 0) {
      await this.deleteConversationById(conversation.id, false);
      return;
    }

    this.mutatingConversation = true;
    this.error = '';

    try {
      await apiFetch(`/api/v1/ai/conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });

      if (this.activeConversationId === conversation.id) {
        this.activeConversationId = null;
        this.messages = [];
      }

      await this.refreshConversations();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Impossible d\'archiver la conversation';
    } finally {
      this.mutatingConversation = false;
    }
  }

  private async archiveAllConversations() {
    if (this.mutatingConversation || this.archiveView !== 'active' || this.conversations.length === 0) return;
    if (!window.confirm('Archiver toutes les conversations actives ?')) return;

    this.mutatingConversation = true;
    this.error = '';

    try {
      await apiFetch('/api/v1/ai/conversations/archive-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      this.activeConversationId = null;
      this.messages = [];
      await this.refreshConversations();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Impossible d\'archiver toutes les conversations';
    } finally {
      this.mutatingConversation = false;
    }
  }

  private async deleteConversationById(conversationId: number, requireConfirm = true) {
    if (this.mutatingConversation) return;
    if (requireConfirm && !window.confirm('Supprimer definitivement cette conversation archivee ?')) return;

    this.mutatingConversation = true;
    this.error = '';

    try {
      await apiFetch(`/api/v1/ai/conversations/${conversationId}`, {
        method: 'DELETE',
      });

      if (this.activeConversationId === conversationId) {
        this.activeConversationId = null;
        this.messages = [];
      }

      await this.refreshConversations();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Impossible de supprimer la conversation';
    } finally {
      this.mutatingConversation = false;
    }
  }

  private async deleteArchivedConversations() {
    if (this.mutatingConversation || this.archiveView !== 'archived' || this.conversations.length === 0) return;
    if (!window.confirm('Supprimer definitivement toutes les conversations archivees ?')) return;

    this.mutatingConversation = true;
    this.error = '';

    try {
      await apiFetch('/api/v1/ai/conversations/archived', {
        method: 'DELETE',
      });
      this.activeConversationId = null;
      this.messages = [];
      await this.refreshConversations();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Impossible de vider les conversations archivees';
    } finally {
      this.mutatingConversation = false;
    }
  }

  private async submitPrompt(contentOverride?: string) {
    const conversationId = this.activeConversationId;
    const content = (contentOverride ?? this.prompt).trim();
    if (!conversationId || !content || this.sending) return;

    if (!this.configured) {
      this.error = this.inactiveAssistantMessage;
      return;
    }

    this.error = '';
    this.sending = true;
    this.prompt = '';
    this.messages = [...this.messages, { role: 'user', content }];
    await this.scrollMessagesToBottom();

    try {
      const data = await apiFetch<{ conversation: Conversation; messages: ChatMessage[]; answer: string; model: string }>('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, content }),
      });
      this.model = data.model;
      this.messages = data.messages;
      await this.refreshConversationListOnly(data.conversation);
      await this.scrollMessagesToBottom();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Échec de la requête IA';
      await this.loadConversation(conversationId);
    } finally {
      this.sending = false;
    }
  }

  private async refreshConversationListOnly(updatedConversation?: Conversation) {
    const archived = this.archiveView === 'archived' ? 1 : 0;
    this.conversations = await apiFetch<Conversation[]>(`/api/v1/ai/conversations?archived=${archived}`);
    if (updatedConversation) {
      this.activeConversationId = updatedConversation.id;
    }
  }

  private async scrollMessagesToBottom() {
    await this.updateComplete;
    const wrap = this.shadowRoot?.querySelector<HTMLElement>('.messages');
    if (wrap) {
      wrap.scrollTop = wrap.scrollHeight;
    }
  }

  private renderMessage(message: ChatMessage) {
    return html`
      <div class="message ${message.role}">
        <div class="message-body">${renderMarkdown(message.content)}</div>
      </div>
    `;
  }

  private async togglePanel() {
    const nextOpen = !this.open;
    this.open = nextOpen;
    if (nextOpen) {
      await this.bootstrap();
    }
  }

  render() {
    return html`
      ${this.open ? html`
        <div class="panel">
          <div class="header">
            <div class="title">
              <div class="name">AI Analyst</div>
              <div class="sub">
                ${this.configured
                  ? html`Assistant dashboard${this.model ? html` • ${this.model}` : nothing}`
                  : 'Configure le token OpenAI dans Settings > AI'}
              </div>
            </div>
            <span class="status ${this.configured ? 'ready' : 'off'}">${this.configured ? 'actif' : 'token requis'}</span>
          </div>

          <aside class="sidebar">
            <div class="sidebar-top">
              <div class="sidebar-label">Conversations</div>
              <button class="new-button" ?disabled=${!this.configured || this.creatingConversation || this.mutatingConversation} @click=${() => void this.createConversation()}>
                ${this.creatingConversation ? 'Création…' : 'Nouvelle conversation'}
              </button>
              ${this.archiveView === 'active' && this.conversations.length > 0 ? html`
                <button class="meta-button warn" ?disabled=${this.mutatingConversation} @click=${() => void this.archiveAllConversations()}>
                  Tout archiver
                </button>
              ` : nothing}
              ${this.archiveView === 'archived' && this.conversations.length > 0 ? html`
                <button class="meta-button danger" ?disabled=${this.mutatingConversation} @click=${() => void this.deleteArchivedConversations()}>
                  Vider archivees
                </button>
              ` : nothing}
            </div>
            <div class="sidebar-filters">
              <div class="sidebar-label">Vue</div>
              <div class="filter-row">
                <button class="view-button ${this.archiveView === 'active' ? 'active' : ''}" @click=${() => void this.setArchiveView('active')}>Actives</button>
                <button class="view-button ${this.archiveView === 'archived' ? 'active' : ''}" @click=${() => void this.setArchiveView('archived')}>Archivées</button>
              </div>
            </div>
            <div class="conversation-list">
              ${this.conversations.map((conversation) => html`
                <div class="conversation-row">
                  <button
                    class="conversation-item ${conversation.id === this.activeConversationId ? 'active' : ''}"
                    @click=${() => void this.loadConversation(conversation.id)}
                  >
                    <span class="conversation-title">${conversation.title}</span>
                    <span class="conversation-preview">${conversation.last_message ?? 'Memoire vide'}</span>
                  </button>
                  ${this.archiveView === 'active' ? html`
                    <button
                    class="conversation-dismiss"
                      title=${(conversation.user_message_count ?? 0) === 0 ? 'Supprimer la conversation vide' : 'Archiver la conversation'}
                      ?disabled=${this.mutatingConversation}
                      @click=${(event: Event) => {
                        event.stopPropagation();
                        void this.archiveConversationById(conversation);
                      }}
                    >
                      ×
                    </button>
                  ` : html`
                    <button
                      class="conversation-dismiss danger"
                      title="Supprimer definitivement"
                      ?disabled=${this.mutatingConversation}
                      @click=${(event: Event) => {
                        event.stopPropagation();
                        void this.deleteConversationById(conversation.id);
                      }}
                    >
                      ×
                    </button>
                  `}
                </div>
              `)}
              ${!this.loadingBootstrap && this.conversations.length === 0 ? html`<div class="empty">Aucune conversation dans cette vue.</div>` : nothing}
            </div>
          </aside>

          <section class="chat-shell">
            <div class="chat-meta">
              <div class="chat-meta-main">
                <strong>${this.activeConversationTitle}</strong>
                <span>${this.messages.length} message${this.messages.length > 1 ? 's' : ''}</span>
              </div>
              <div class="chat-meta-actions">
                ${this.archiveView === 'active'
                  ? html`<button class="meta-button warn" ?disabled=${this.mutatingConversation || !this.activeConversationId} @click=${() => void this.archiveConversation(true)}>Archiver</button>`
                  : html`<button class="meta-button" ?disabled=${this.mutatingConversation || !this.activeConversationId} @click=${() => void this.archiveConversation(false)}>Restaurer</button>`}
              </div>
            </div>

            <div class="messages">
              ${this.loadingBootstrap ? html`<div class="loading">Initialisation de l'assistant…</div>` : nothing}
              ${this.loadingMessages ? html`<div class="loading">Chargement de l'historique…</div>` : nothing}
              ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
              ${!this.configured ? html`<div class="empty">${this.inactiveAssistantMessage}</div>` : nothing}
              ${this.configured && !this.loadingBootstrap && !this.loadingMessages && !this.activeConversationId ? html`<div class="empty">Ouvre une nouvelle conversation pour interroger le dashboard.</div>` : nothing}
              ${this.configured && !this.loadingBootstrap && !this.loadingMessages && this.activeConversationId !== null && this.messages.length === 0 ? html`<div class="empty">Aucun message pour cette conversation.</div>` : nothing}
              ${this.showGuidedActions ? html`
                <div class="guided">
                  <div class="guided-title">Actions guidées</div>
                  <div class="guided-list">
                    ${GUIDED_ACTIONS.map((action) => html`
                      <button class="chip" ?disabled=${this.sending} @click=${() => void this.submitPrompt(action)}>${action}</button>
                    `)}
                  </div>
                </div>
              ` : nothing}
              ${this.messages.map((message) => this.renderMessage(message))}
              ${this.sending ? html`<div class="message assistant"><div class="message-body"><p>Analyse en cours…</p></div></div>` : nothing}
            </div>

            ${this.showComposer ? html`
              <div class="composer">
                <textarea
                  .value=${this.prompt}
                  @input=${(event: Event) => {
                    this.prompt = (event.target as HTMLTextAreaElement).value;
                  }}
                  @keydown=${(event: KeyboardEvent) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void this.submitPrompt();
                    }
                  }}
                  placeholder="Pose une question sur l'état du système, les alerts ou les services…"
                ></textarea>
                <div class="actions">
                  <button class="send" ?disabled=${this.sending || !this.prompt.trim() || !this.activeConversationId} @click=${() => void this.submitPrompt()}>
                    Envoyer
                  </button>
                </div>
              </div>
            ` : nothing}
          </section>
        </div>
      ` : nothing}
      <button class="launcher" @click=${() => void this.togglePanel()}>${this.open ? 'Fermer' : 'IA'}</button>
    `;
  }
}
