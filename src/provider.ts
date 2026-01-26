import * as vscode from 'vscode';
import type { CodemapFlow, CodemapMeta, CodemapNode } from './types';

function formattedDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
}

export class CodemapTreeDataProvider implements vscode.TreeDataProvider<CodemapNode> {
  private flows: CodemapFlow[] = [];
  private activeFlowId: string | null = null;
  private _onDidChangeTreeData = new vscode.EventEmitter<CodemapNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getFlows(): CodemapFlow[] {
    return this.flows;
  }

  getActiveFlowId(): string | null {
    return this.activeFlowId;
  }

  getActiveFlow(): CodemapFlow | null {
    if (!this.activeFlowId) return this.flows[0] ?? null;
    return this.flows.find((f) => f.id === this.activeFlowId) ?? null;
  }

  getRoots(): CodemapNode[] {
    return this.getActiveFlow()?.roots ?? [];
  }

  getMeta(): CodemapMeta | null {
    return this.getActiveFlow()?.meta ?? null;
  }

  addFlow(flow: CodemapFlow, makeActive = true): void {
    this.flows = [...this.flows, flow];
    if (makeActive || !this.activeFlowId) this.activeFlowId = flow.id;
    this._onDidChangeTreeData.fire();
  }

  updateFlow(flow: CodemapFlow): void {
    this.flows = this.flows.map((f) => (f.id === flow.id ? flow : f));
    this._onDidChangeTreeData.fire();
  }

  setActiveFlow(id: string): void {
    if (this.activeFlowId === id) return;
    const exists = this.flows.some((f) => f.id === id);
    if (!exists) return;
    this.activeFlowId = id;
    this._onDidChangeTreeData.fire();
  }

  getChildren(node?: CodemapNode): CodemapNode[] {
    if ((node as CodemapNode & { isOverview?: boolean })?.isOverview === true) return [];
    if (!node) {
      const m = this.getMeta();
      const hasMeta = m && (m.title || m.overview || m.createdAt);
      const overviewNode: CodemapNode & { isOverview?: boolean } = {
        label: m?.title || 'Codeflow',
        description: [formattedDate(m?.createdAt), m?.overview].filter(Boolean).join(' · ').slice(0, 120),
        children: [],
      };
      overviewNode.isOverview = true;
      return (hasMeta ? [overviewNode] : []).concat(this.getRoots());
    }
    return node.children ?? [];
  }

  getTreeItem(node: CodemapNode): vscode.TreeItem {
    const isOverview = (node as CodemapNode & { isOverview?: boolean }).isOverview === true;
    if (isOverview) {
      const m = this.getMeta();
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = node.description;
      item.contextValue = 'codeflowOverview';
      const parts: string[] = [];
      if (m?.createdAt) parts.push(`**Created:** ${formattedDate(m.createdAt)}`);
      if (m?.overview) parts.push(`**Overview:** ${m.overview}`);
      if (parts.length) item.tooltip = new vscode.MarkdownString(parts.join('\n\n'));
      return item;
    }

    const hasChildren = (node.children?.length ?? 0) > 0;
    const label = node.number ? `${node.number} ${node.label}` : node.label;
    const item = new vscode.TreeItem(
      label,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    if (hasChildren) {
      item.description = node.description;
      item.contextValue = 'codeflowSection';
    } else {
      item.description = [node.filePath, node.snippet].filter(Boolean).join(' · ');
      item.contextValue = 'codeflowNode';
    }
    const tooltipParts: string[] = [];
    if (node.description) tooltipParts.push(`**What it does:** ${node.description}`);
    if (node.filePath) {
      const line = node.range?.startLine != null ? `:${node.range.startLine + 1}` : '';
      tooltipParts.push(`**File:** \`${node.filePath}${line}\``);
    }
    if (node.snippet) tooltipParts.push(`**Snippet:** \`${node.snippet}\``);
    if (tooltipParts.length) item.tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'));
    if (node.filePath && node.range) {
      item.command = { command: 'codeflow.openNode', title: '', arguments: [node] };
    }
    return item;
  }
}
