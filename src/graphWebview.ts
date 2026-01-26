import * as vscode from 'vscode';
import { rootsToMermaid } from './mermaid';
import type { CodemapNode } from './types';

let panel: vscode.WebviewPanel | undefined;
let graphIdToNode: Map<string, CodemapNode> = new Map();

function buildHtml(mermaidDef: string, nodeIds: string[]): string {
  const idsJson = JSON.stringify(nodeIds);
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body{font-family:var(--vscode-font-family);padding:1em;margin:0;}
  #toolbar{display:flex;align-items:center;gap:0.5em;padding-bottom:0.5em;}
  #toolbar button{min-width:2em;cursor:pointer;}
  #graph-wrap{overflow:auto;min-height:200px;height:75vh;}
  #zoom-container{transform-origin:0 0;}
</style></head>
<body>
<div id="toolbar"><button id="zoom-out">−</button><span id="zoom-pct">100%</span><button id="zoom-in">+</button></div>
<div id="graph-wrap"><div id="zoom-container"><div id="mermaid"></div></div></div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  (function() {
    var d = ${JSON.stringify(mermaidDef)};
    var ids = ${idsJson};
    var el = document.getElementById('mermaid');
    var zc = document.getElementById('zoom-container');
    var zp = document.getElementById('zoom-pct');
    var zw = document.getElementById('graph-wrap');
    var scale = 1;
    function applyZoom() { zc.style.transform = 'scale(' + scale + ')'; zp.textContent = Math.round(scale * 100) + '%'; }
    document.getElementById('zoom-out').onclick = function() { scale = Math.max(0.25, scale / 1.2); applyZoom(); };
    document.getElementById('zoom-in').onclick = function() { scale = Math.min(3, scale * 1.2); applyZoom(); };
    zw.addEventListener('wheel', function(e) {
      if (e.ctrlKey) {
        e.preventDefault();
        scale = Math.max(0.25, Math.min(3, e.deltaY > 0 ? scale / 1.1 : scale * 1.1));
        applyZoom();
      }
    }, { passive: false });
    mermaid.render('mermaid-svg', d).then(function(r) {
      el.innerHTML = r.svg;
      var vs = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
      if (vs && ids) {
        ids.forEach(function(id) {
          var g = el.querySelector('g[id="' + id + '"], g[id^="' + id + '-"], g[id*="-' + id + '-"]');
          if (g) {
            g.style.cursor = 'pointer';
            g.addEventListener('click', function() { vs.postMessage({ type: 'openNode', id: id }); });
          }
        });
      }
    }).catch(function(e) {
      el.textContent = 'Mermaid error: ' + (e.message || String(e));
    });
  })();
</script>
</body>
</html>`;
}

export function createOrRevealGraphPanel(roots: CodemapNode[], onOpenNode: (node: CodemapNode) => void): void {
  if (roots.length === 0) {
    vscode.window.showInformationMessage('Create a codeflow first.');
    return;
  }

  const { def, idToNode } = rootsToMermaid(roots);
  graphIdToNode = idToNode;
  const nodeIds = Array.from(idToNode.keys());

  if (panel) {
    panel.reveal();
    panel.webview.html = buildHtml(def, nodeIds);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'codeflow.graph',
    'Codeflow (Graph)',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = buildHtml(def, nodeIds);

  panel.webview.onDidReceiveMessage((msg: { type?: string; id?: string }) => {
    if (msg?.type === 'openNode' && typeof msg.id === 'string') {
      const node = graphIdToNode.get(msg.id);
      if (node) onOpenNode(node);
    }
  });

  panel.onDidDispose(() => {
    panel = undefined;
  });
}
