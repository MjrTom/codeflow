import * as vscode from 'vscode';
import * as fs from 'fs';
import { runAgent } from './agent';
import { CodemapTreeDataProvider } from './provider';
import { createOrRevealGraphPanel } from './graphWebview';
import { CodemapWebviewViewProvider } from './codemapView';
import { rootsToMermaid } from './mermaid';
import { isFileTooLarge } from './fsUtil';
import { setLogChannel, log } from './logger';
import type { CodemapMeta, CodemapNode } from './types';

let codemapDecoration: { editor: vscode.TextEditor; range: vscode.Range } | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const codeflowChannel = vscode.window.createOutputChannel('Codeflow');
  context.subscriptions.push(codeflowChannel);
  setLogChannel(codeflowChannel);

  const codemapDecorationType = vscode.window.createTextEditorDecorationType({});
  context.subscriptions.push(codemapDecorationType);

  vscode.window.onDidChangeActiveTextEditor(() => {
    if (codemapDecoration) {
      codemapDecoration.editor.setDecorations(codemapDecorationType, []);
      codemapDecoration = null;
    }
  });

  const provider = new CodemapTreeDataProvider();
  const codemapView = new CodemapWebviewViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codeflow', codemapView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('codeflow.create', async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: 'Describe what to map (e.g. "How does auth work?", "main entry point")',
        placeHolder: 'Question or topic for the codeflow',
      });
      if (prompt == null || prompt.trim() === '') return;
      try {
        const { meta, roots } = await runAgent(prompt.trim());
        meta.createdAt = new Date().toISOString();
        context.globalState.update('codeflow.meta', meta);
        provider.refresh(roots, meta);
        codemapView.update(roots, meta);
        const recent = (context.globalState.get<string[]>('codeflow.recentPrompts') ?? []).slice(0, 4);
        context.globalState.update('codeflow.recentPrompts', [prompt.trim(), ...recent]);
        context.globalState.update('codeflow.lastPrompt', prompt.trim());
      } catch (e) {
        const msg = (e as Error).message;
        log(`Create failed: ${msg}`);
        vscode.window.showErrorMessage(msg);
      }
    }),

    vscode.commands.registerCommand('codeflow.openNode', async (node: CodemapNode) => {
      if (!node?.filePath) return;
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      if (codemapDecoration) {
        codemapDecoration.editor.setDecorations(codemapDecorationType, []);
        codemapDecoration = null;
      }
      const p = vscode.Uri.joinPath(folder.uri, node.filePath);
      if (await isFileTooLarge(p)) {
        await vscode.commands.executeCommand('vscode.open', p);
        vscode.window.showWarningMessage('File is large; opened without selection.');
        return;
      }

      const r =
        node.range != null
          ? new vscode.Range(
              Math.max(0, node.range.startLine),
              0,
              Math.max(0, node.range.endLine ?? node.range.startLine),
              0
            )
          : null;
      try {
        const showOptions: vscode.TextDocumentShowOptions = { preview: false };
        if (r) showOptions.selection = r;
        await vscode.window.showTextDocument(p, showOptions);
      } catch (e) {
        log(`Open failed: ${(e as Error).message}`);
        await vscode.commands.executeCommand('vscode.open', p);
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.toString() === p.toString() && r) {
        const text = (node.number || node.description || node.label || '').trim().slice(0, 40);
        editor.setDecorations(codemapDecorationType, [
          {
            range: r,
            renderOptions: {
              before: {
                contentText: text,
                margin: '0 0.6em 0 0',
                color: new vscode.ThemeColor('badge.foreground'),
                backgroundColor: new vscode.ThemeColor('badge.background'),
                fontWeight: '600',
              },
            },
          },
        ]);
        codemapDecoration = { editor, range: r };
      }
    }),

    vscode.commands.registerCommand('codeflow.refresh', async () => {
      const last = context.globalState.get<string>('codeflow.lastPrompt');
      if (!last) {
        await vscode.commands.executeCommand('codeflow.create');
        return;
      }
      try {
        const oldMeta = context.globalState.get<CodemapMeta>('codeflow.meta');
        const { meta, roots } = await runAgent(last);
        meta.createdAt = oldMeta?.createdAt ?? new Date().toISOString();
        context.globalState.update('codeflow.meta', meta);
        provider.refresh(roots, meta);
        codemapView.update(roots, meta);
      } catch (e) {
        const msg = (e as Error).message;
        log(`Refresh failed: ${msg}`);
        vscode.window.showErrorMessage(msg);
      }
    }),

    vscode.commands.registerCommand('codeflow.openGraph', () => {
      createOrRevealGraphPanel(provider.getRoots(), (node) => {
        void vscode.commands.executeCommand('codeflow.openNode', node);
      });
    }),

    vscode.commands.registerCommand('codeflow.exportJSON', async () => {
      const roots = provider.getRoots();
      if (roots.length === 0) {
        vscode.window.showInformationMessage('Create a codeflow first.');
        return;
      }
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('codeflow.json'),
        filters: { JSON: ['json'] },
      });
      if (!uri) return;
      fs.writeFileSync(uri.fsPath, JSON.stringify(roots, null, 2), 'utf-8');
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }),

    vscode.commands.registerCommand('codeflow.exportHTML', async () => {
      const roots = provider.getRoots();
      if (roots.length === 0) {
        vscode.window.showInformationMessage('Create a codeflow first.');
        return;
      }
      const html = buildExportHtml(roots);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('codeflow.html'),
        filters: { HTML: ['html'] },
      });
      if (!uri) return;
      fs.writeFileSync(uri.fsPath, html, 'utf-8');
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }),

    vscode.commands.registerCommand('codeflow.focusView', () => {
      void vscode.commands.executeCommand('workbench.view.extension.codeflow');
    }),

    vscode.commands.registerCommand('codeflow.copyPath', (node: CodemapNode) => {
      if (node?.filePath) {
        void vscode.env.clipboard.writeText(node.filePath);
        vscode.window.setStatusBarMessage(`Copied: ${node.filePath}`, 2000);
      }
    }),

    vscode.commands.registerCommand('codeflow.seeMore', (node: CodemapNode) => {
      const msg = [node.description, node.filePath].filter(Boolean).join(' — ');
      if (msg) vscode.window.showInformationMessage(msg, { modal: false });
    })
  );
}

function buildExportHtml(roots: CodemapNode[]): string {
  const { def } = rootsToMermaid(roots);
  const legend = rootsToLegend(roots);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>body{font-family:system-ui,sans-serif;padding:1em;max-width:960px;margin:0 auto;} .mermaid{text-align:center;} ul{font-size:0.9em;color:#444;}</style>
</head>
<body>
  <h1>Codeflow</h1>
  <div class="mermaid">\n${def}\n</div>
  <h2>Legend</h2>
  <ul>${legend}</ul>
  <script>mermaid.initialize({startOnLoad:false,theme:'neutral'}); mermaid.run();</script>
</body>
</html>`;
}

function rootsToLegend(roots: CodemapNode[]): string {
  const items: string[] = [];
  function walk(n: CodemapNode) {
    if (n.filePath) {
      const line = n.range?.startLine != null ? `:${(n.range.startLine + 1)}` : '';
      items.push(`<li><strong>${escapeHtml(n.label)}</strong> — ${escapeHtml(n.filePath)}${line}</li>`);
    }
    for (const c of n.children ?? []) walk(c);
  }
  for (const r of roots) walk(r);
  return items.join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function deactivate(): void {}
