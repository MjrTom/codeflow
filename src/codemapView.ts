import * as vscode from 'vscode';
import type { CodemapMeta, CodemapNode } from './types';

type WebviewMessage =
  | { type: 'openNode'; id: string }
  | { type: 'copyPath'; id: string }
  | { type: 'seeMore'; id: string }
  | { type: 'create' };

export class CodemapWebviewViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private roots: CodemapNode[] = [];
  private meta: CodemapMeta | null = null;
  private nodeById: Map<string, CodemapNode> = new Map();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    view.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'create') {
        void vscode.commands.executeCommand('codeflow.create');
        return;
      }
      const node = this.nodeById.get(msg.id);
      if (!node) return;
      switch (msg.type) {
        case 'openNode':
          void vscode.commands.executeCommand('codeflow.openNode', node);
          break;
        case 'copyPath':
          void vscode.commands.executeCommand('codeflow.copyPath', node);
          break;
        case 'seeMore':
          void vscode.commands.executeCommand('codeflow.seeMore', node);
          break;
        default:
          break;
      }
    });

    this.render();
  }

  update(roots: CodemapNode[], meta?: CodemapMeta | null): void {
    this.roots = roots;
    this.meta = meta ?? null;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    const { html, nodeById } = buildHtml(this.view.webview, this.roots, this.meta);
    this.nodeById = nodeById;
    this.view.webview.html = html;
  }
}

function buildHtml(
  webview: vscode.Webview,
  roots: CodemapNode[],
  meta: CodemapMeta | null
): { html: string; nodeById: Map<string, CodemapNode> } {
  const nonce = getNonce();
  const nodeById = new Map<string, CodemapNode>();
  let nextId = 0;

  function nodeId(node: CodemapNode): string {
    const id = `n${++nextId}`;
    nodeById.set(id, node);
    return id;
  }

  function formatLine(node: CodemapNode): string {
    if (!node.filePath) return '';
    const line = node.range?.startLine != null ? `:${node.range.startLine + 1}` : '';
    return `${node.filePath}${line}`;
  }

  function renderNode(node: CodemapNode, level: number): string {
    const id = nodeId(node);
    const number = node.number ? escapeHtml(node.number) : '';
    const label = escapeHtml(node.label);
    const desc = node.description ? `<div class="desc">${escapeHtml(node.description)}</div>` : '';
    const snippet = node.snippet ? `<div class="snippet">${escapeHtml(node.snippet)}</div>` : '';
    const fileInfo = node.filePath ? `<div class="meta">${escapeHtml(formatLine(node))}</div>` : '';
    const hasChildren = (node.children?.length ?? 0) > 0;
    const canOpen = !!node.filePath;
    const badge = number ? `<span class="badge">${number}</span>` : '';

    if (hasChildren) {
      const openButton = canOpen
        ? `<button class="icon-btn" data-action="open" title="Open in editor">Open</button>`
        : '';
      const seeMore = node.description ? `<button class="link" data-action="see-more">See more</button>` : '';
      const childrenHtml = node.children.map((c) => renderNode(c, level + 1)).join('');
      return `<div class="node section" data-node-id="${id}" data-level="${level}">
  <div class="row" data-action="toggle" role="button" tabindex="0">
    <span class="toggle" aria-hidden="true">v</span>
    ${badge}
    <span class="label">${label}</span>
    ${openButton}
  </div>
  ${desc}
  <div class="children">${childrenHtml}</div>
  ${seeMore}
</div>`;
    }

    const openAttrs = canOpen ? 'data-action="open" data-open="1" tabindex="0"' : '';
    const copyButton = canOpen
      ? `<button class="icon-btn" data-action="copy" title="Copy path">Copy</button>`
      : '';
    return `<div class="node leaf ${canOpen ? 'can-open' : ''}" data-node-id="${id}" data-level="${level}" ${openAttrs}>
  <div class="row">
    ${badge}
    <span class="label">${label}</span>
    ${copyButton}
  </div>
  ${desc}
  ${snippet}
  ${fileInfo}
</div>`;
  }

  const title = meta?.title?.trim() || 'Codeflow';
  const createdAt = meta?.createdAt ? formatDate(meta.createdAt) : '';
  const overview = meta?.overview?.trim() || '';

  const header = roots.length
    ? `<div class="header">
  <div class="title">${escapeHtml(title)}</div>
  ${createdAt ? `<div class="meta">${escapeHtml(createdAt)}</div>` : ''}
  ${overview ? `<div class="overview">${escapeHtml(overview)}</div>` : ''}
</div>`
    : `<div class="empty">
  <div class="empty-title">No codeflow yet.</div>
  <div class="empty-desc">Use the button below or the view toolbar to create one.</div>
  <button class="primary-btn" data-action="create">Create Codeflow</button>
</div>`;

  const body = roots.length ? roots.map((r) => renderNode(r, 0)).join('') : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      color-scheme: light dark;
      --cm-bg: var(--vscode-sideBar-background);
      --cm-card: var(--vscode-editorWidget-background);
      --cm-border: var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3));
      --cm-muted: var(--vscode-descriptionForeground);
      --cm-hover: var(--vscode-list-hoverBackground);
      --cm-focus: var(--vscode-focusBorder);
      --cm-badge-bg: var(--vscode-badge-background);
      --cm-badge-fg: var(--vscode-badge-foreground);
      --cm-code-bg: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      --cm-code-fg: var(--vscode-editor-foreground);
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--cm-bg);
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-font-family);
    }
    .container {
      padding: 10px;
    }
    .header, .empty {
      background: var(--cm-card);
      border: 1px solid var(--cm-border);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .title {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
    }
    .overview {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.4;
      color: var(--cm-muted);
    }
    .meta {
      margin-top: 4px;
      font-size: 11px;
      color: var(--cm-muted);
    }
    .empty-title {
      font-size: 12px;
      font-weight: 600;
    }
    .empty-desc {
      margin-top: 4px;
      font-size: 11px;
      color: var(--cm-muted);
    }
    .primary-btn {
      margin-top: 8px;
      border: 1px solid var(--cm-focus);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .node {
      border: 1px solid var(--cm-border);
      border-radius: 6px;
      padding: 8px;
      margin-top: 8px;
      background: var(--cm-card);
    }
    .node.section {
      background: var(--vscode-sideBar-background);
    }
    .node.leaf.can-open:hover {
      background: var(--cm-hover);
      border-color: var(--cm-focus);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .row[role="button"] {
      cursor: pointer;
    }
    .toggle {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--cm-border);
      border-radius: 3px;
      font-size: 10px;
      color: var(--cm-muted);
      background: transparent;
    }
    .badge {
      background: var(--cm-badge-bg);
      color: var(--cm-badge-fg);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
    .label {
      font-size: 12px;
      font-weight: 600;
      flex: 1;
      line-height: 1.2;
    }
    .desc {
      margin-top: 6px;
      font-size: 11px;
      color: var(--cm-muted);
      line-height: 1.3;
    }
    .snippet {
      margin-top: 6px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      color: var(--cm-code-fg);
      background: var(--cm-code-bg);
      border: 1px solid var(--cm-border);
      border-radius: 4px;
      padding: 4px 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .children {
      margin-top: 6px;
      padding-left: 10px;
      border-left: 1px solid var(--cm-border);
    }
    .node.collapsed > .children {
      display: none;
    }
    .link {
      margin-top: 6px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-size: 11px;
      text-align: left;
    }
    .icon-btn {
      border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      padding: 1px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 10px;
    }
    .icon-btn:hover {
      border-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
  </style>
</head>
<body>
  <div class="container">
    ${header}
    ${body}
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function nodeFor(el) {
      return el && el.closest('[data-node-id]');
    }
    function toggleNode(nodeEl) {
      nodeEl.classList.toggle('collapsed');
      const t = nodeEl.querySelector(':scope > .row .toggle');
      if (t) t.textContent = nodeEl.classList.contains('collapsed') ? '>' : 'v';
    }
    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.getAttribute('data-action');
      if (!action) return;
      if (action === 'create') {
        vscode.postMessage({ type: 'create' });
        return;
      }
      const nodeEl = nodeFor(actionEl);
      if (!nodeEl) return;
      const id = nodeEl.getAttribute('data-node-id');
      if (!id) return;
      if (action === 'toggle') {
        toggleNode(nodeEl);
        return;
      }
      if (action === 'open') {
        vscode.postMessage({ type: 'openNode', id });
        return;
      }
      if (action === 'copy') {
        vscode.postMessage({ type: 'copyPath', id });
        return;
      }
      if (action === 'see-more') {
        vscode.postMessage({ type: 'seeMore', id });
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const active = document.activeElement;
      if (!active) return;
      const action = active.getAttribute('data-action');
      if (!action) return;
      if (action === 'toggle') {
        const nodeEl = nodeFor(active);
        if (nodeEl) toggleNode(nodeEl);
        return;
      }
      if (action === 'open') {
        const nodeEl = nodeFor(active);
        const id = nodeEl ? nodeEl.getAttribute('data-node-id') : null;
        if (id) vscode.postMessage({ type: 'openNode', id });
      }
    });
  </script>
</body>
</html>`;

  return { html, nodeById };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
