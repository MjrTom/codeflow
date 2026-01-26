import * as vscode from 'vscode';
import * as path from 'path';
import { chatCompletion, getLlmConfig, validateLlmConfig } from './llm';
import { isFileTooLarge } from './fsUtil';
import type { CodemapMeta, CodemapNode, CodemapRange } from './types';

const SYSTEM = `You are a codebase analyst. Given a user question and a list of file paths and symbols (with line numbers), produce a single JSON object: {"title"?: string, "roots": [{"label": string, "description"?: string, "filePath"?: string, "range"?: {"startLine": number, "endLine"?: number}, "children": [...]}]}. Optional top-level "title" = short codeflow title. Structure the map as a clear outline: 3-7 top-level sections, each with 2-6 ordered child steps. Keep depth to 2 unless a third level is truly needed. Order nodes by execution flow or the flow implied by the question. Use short, action-oriented labels. Add a one-phrase description for each top-level section and each leaf node. Leaf nodes should include filePath and range from the provided context. Use only filePath and ranges from the provided context. Return only valid JSON, no markdown or extra text.`;

const OVERVIEW_SYSTEM = `You write short overview paragraphs. Given a numbered outline of a codeflow, write 2-4 sentences summarizing the whole map. Reference specific nodes in square brackets by their id, e.g. [1c], [2a]. Use 2-4 such references. Return only the overview text, no JSON or markdown.`;

const MAX_FILES = 200;
const MAX_FILES_FOR_SYMBOLS = 50;
const SNIPPET_MAX = 70;

export async function runAgent(prompt: string): Promise<{ meta: CodemapMeta; roots: CodemapNode[] }> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a workspace folder first.');
  }

  const cfg = vscode.workspace.getConfiguration('codeflow');
  const include = cfg.get<string>('include') ?? '**/*.{ts,tsx,js,jsx,py,go,rs,java,kt}';
  const exclude = cfg.get<string>('exclude') ?? '**/node_modules/**,**/.git/**,**/dist/**,**/build/**';

  const { apiBase, apiKey, model, maxTokens, timeoutMs } = getLlmConfig();
  const err = validateLlmConfig(apiBase, apiKey);
  if (err) {
    vscode.window.showErrorMessage(err);
    void vscode.commands.executeCommand('workbench.action.openSettings', 'codeflow');
    throw new Error(err);
  }

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Codeflow: Generating…', cancellable: false },
    async () => {
      const context = await buildContext(folder, prompt, include, exclude);
      const user = `Question: ${prompt}\n\nContext:\n${context}`;

      const content = await chatCompletion(
        apiBase,
        apiKey,
        model,
        [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        maxTokens,
        timeoutMs
      );

      const knownPaths = new Set((context.match(/^## (.+)$/gm) ?? []).map((m) => m.slice(3).trim()));
      const { meta, roots } = parseCodemapResponse(content, knownPaths);
      inheritFilePaths(roots);
      await attachSnippets(roots, folder);
      assignNumbers(roots);
      const outline = formatNumberedOutline(roots);

      const overviewContent = await chatCompletion(
        apiBase,
        apiKey,
        model,
        [{ role: 'system', content: OVERVIEW_SYSTEM }, { role: 'user', content: outline }],
        Math.min(maxTokens, 512),
        timeoutMs
      );
      let overview = overviewContent.trim();
      const codeFence = overview.match(/^```\w*\s*([\s\S]*?)```$/);
      if (codeFence) overview = codeFence[1].trim();
      meta.overview = overview;
      if (!meta.title) meta.title = prompt;

      return { meta, roots };
    }
  );
}

function parseCodemapResponse(raw: string, knownPaths: Set<string>): { meta: CodemapMeta; roots: CodemapNode[] } {
  let json = raw.trim();
  const m = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) json = m[1].trim();

  let obj: { title?: unknown; roots?: unknown };
  try {
    obj = JSON.parse(json) as { title?: unknown; roots?: unknown };
  } catch (e) {
    throw new Error(`LLM did not return valid JSON: ${(e as Error).message}`);
  }

  const rawRoots = Array.isArray(obj.roots) ? obj.roots : (Array.isArray(obj) ? obj : []);
  const roots = rawRoots
    .map((r) => normalizeNode(r, knownPaths))
    .filter((n): n is CodemapNode => !!n);
  const meta: CodemapMeta = { title: typeof obj.title === 'string' ? obj.title : undefined };
  return { meta, roots };
}

async function attachSnippets(nodes: CodemapNode[], folder: vscode.WorkspaceFolder): Promise<void> {
  for (const n of nodes) {
    if (n.filePath && n.range) {
      try {
        const uri = vscode.Uri.joinPath(folder.uri, n.filePath);
        if (!(await isFileTooLarge(uri))) {
          const doc = await vscode.workspace.openTextDocument(uri);
          const end = n.range.endLine ?? n.range.startLine;
          const r = new vscode.Range(n.range.startLine, 0, end, 999);
          let t = doc.getText(r).replace(/\s+/g, ' ').trim();
          n.snippet = t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX) + '…' : t;
        }
      } catch {
        // leave snippet unset
      }
    }
    if (n.children?.length) await attachSnippets(n.children, folder);
  }
}

function assignNumbers(nodes: CodemapNode[], parentNum?: string): void {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (parentNum === undefined) {
      n.number = String(i + 1);
    } else {
      n.number = parentNum + (parentNum.length === 1 ? String.fromCharCode(97 + i) : String(i + 1));
    }
    if (n.children?.length) assignNumbers(n.children, n.number);
  }
}

function formatNumberedOutline(roots: CodemapNode[]): string {
  const lines: string[] = [];
  function walk(n: CodemapNode) {
    if (n.number) lines.push(`${n.number} ${n.label}`);
    for (const c of n.children ?? []) walk(c);
  }
  for (const r of roots) walk(r);
  return lines.join('\n');
}

async function buildContext(
  folder: vscode.WorkspaceFolder,
  prompt: string,
  include: string,
  exclude: string
): Promise<string> {
  const incl = (include || '**/*').trim();
  const excl = (exclude || '').split(',')[0]?.trim() || '**/node_modules/**';
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, incl),
    new vscode.RelativePattern(folder, excl),
    MAX_FILES
  );

  const root = folder.uri.fsPath;
  const keywords = new Set(prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 2));

  const withScore = uris.map((u) => {
    const rel = path.relative(root, u.fsPath);
    let score = 0;
    for (const k of keywords) {
      if (rel.toLowerCase().includes(k)) score += 2;
    }
    return { uri: u, rel, score };
  });
  withScore.sort((a, b) => b.score - a.score);
  const subset = withScore.slice(0, MAX_FILES_FOR_SYMBOLS).map((x) => x.uri);

  const lines: string[] = [];
  for (const uri of subset) {
    const rel = path.relative(root, uri.fsPath).replace(/\\/g, '/');
    if (await isFileTooLarge(uri)) {
      lines.push(`## ${rel}`, '(skipped: file too large for symbol sync)', '');
      continue;
    }
    const syms = (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      uri
    )) ?? [];
    const flat: string[] = [];
    function walk(s: vscode.DocumentSymbol) {
      const r = s.range;
      flat.push(`- ${s.name} (Line ${r.start.line + 1})`);
      for (const c of s.children ?? []) walk(c);
    }
    for (const s of syms) walk(s);
    if (flat.length) {
      lines.push(`## ${rel}`, ...flat, '');
    } else {
      lines.push(`## ${rel}`, '(no symbols)', '');
    }
  }

  return lines.join('\n') || '(no files or symbols found)';
}

function inheritFilePaths(nodes: CodemapNode[], parentPath?: string): void {
  for (const n of nodes) {
    if (n.range && !n.filePath && parentPath) n.filePath = parentPath;
    const next = n.filePath ?? parentPath;
    if (n.children?.length) inheritFilePaths(n.children, next);
  }
}

function normalizeNode(o: unknown, knownPaths: Set<string>): CodemapNode | null {
  if (!o || typeof o !== 'object') return null;
  const v = o as Record<string, unknown>;
  const label = typeof v.label === 'string' ? v.label : '?';
  let filePath: string | undefined;
  if (typeof v.filePath === 'string') {
    const fp = v.filePath.replace(/\\/g, '/');
    if (knownPaths.has(fp)) filePath = fp;
  }
  let range: CodemapRange | undefined;
  if (v.range && typeof v.range === 'object') {
    const r = v.range as Record<string, unknown>;
    const start = typeof r.startLine === 'number' ? r.startLine : undefined;
    if (start !== undefined) {
      // LLM context uses 1-based "Line L"; convert to 0-based for VS Code Range
      range = {
        startLine: Math.max(0, start - 1),
        endLine: typeof r.endLine === 'number' ? Math.max(0, r.endLine - 1) : undefined,
      };
    }
  }
  const description = typeof v.description === 'string' ? v.description : undefined;
  const children = Array.isArray(v.children)
    ? v.children.map((c) => normalizeNode(c, knownPaths)).filter((n): n is CodemapNode => !!n)
    : [];
  return { label, description, filePath, range, children };
}
