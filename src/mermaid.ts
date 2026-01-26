import type { CodemapNode } from './types';

/**
 * Sanitize label for Mermaid: replace `[` `]` `"` `'` and other chars that break syntax.
 */
function sanitizeLabel(s: string): string {
  return s.replace(/[[\]"'()#;]/g, '-').replace(/\n/g, ' ').slice(0, 80);
}

/**
 * Build Mermaid flowchart definition and id->node map from roots.
 * Used by graphWebview (def + idToNode for click) and export HTML (def only).
 */
export function rootsToMermaid(roots: CodemapNode[]): { def: string; idToNode: Map<string, CodemapNode> } {
  const idToNode = new Map<string, CodemapNode>();
  let id = 0;
  const lines: string[] = ['flowchart TB'];

  function nodeId(n: CodemapNode): string {
    const k = `n${id++}`;
    idToNode.set(k, n);
    return k;
  }

  function add(n: CodemapNode, parentId: string | null) {
    const k = nodeId(n);
    const lab = sanitizeLabel(n.label);
    lines.push(`${k}["${lab}"]`);
    if (parentId !== null) lines.push(`${parentId} --> ${k}`);
    for (const c of n.children ?? []) add(c, k);
  }

  for (const r of roots) add(r, null);
  return { def: lines.join('\n'), idToNode };
}
