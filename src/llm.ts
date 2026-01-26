import * as vscode from 'vscode';
import { log } from './logger';

export async function chatCompletion(
  apiBase: string,
  apiKey: string,
  model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  maxTokens: number,
  timeoutMs: number
): Promise<string> {
  const base = apiBase.replace(/\/$/, '');
  const path = /\/v\d+$/i.test(base) ? '/chat/completions' : '/v1/chat/completions';
  const url = base + path;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const opts: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  };
  if (timeoutMs > 0) {
    const controller = new AbortController();
    timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    opts.signal = controller.signal;
  }

  log(`LLM request: POST ${url} (${timeoutMs > 0 ? `timeout ${timeoutMs}ms` : 'no client timeout'})`);

  try {
    const res = await fetch(url, opts);

    if (!res.ok) {
      const text = await res.text();
      log(`LLM HTTP ${res.status}: ${text.slice(0, 400)}`);
      throw new Error(`LLM request failed: ${res.status} ${res.statusText}. ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      log('LLM response missing choices[0].message.content');
      throw new Error('LLM response missing choices[0].message.content');
    }
    log('LLM request completed OK');
    return content;
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err?.name === 'AbortError') {
      log('LLM request aborted (timeout or AbortController). name=AbortError');
    } else {
      log(`LLM request error: ${err?.name ?? 'Error'} - ${err?.message ?? String(e)}`);
    }
    throw e;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function getLlmConfig(): {
  apiBase: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
} {
  const c = vscode.workspace.getConfiguration('codeflow');
  const apiBase = (c.get<string>('apiBase') ?? '').trim();
  const apiKey = (c.get<string>('apiKey') ?? '').trim();
  const model = (c.get<string>('model') ?? 'modelname').trim();
  const maxTokens = c.get<number>('maxTokens') ?? 120000;
  const timeoutMs = c.get<number>('timeoutMs') ?? 0;
  return { apiBase, apiKey, model, maxTokens, timeoutMs };
}

export function validateLlmConfig(apiBase: string, apiKey: string): string | null {
  if (!apiBase) return 'Configure codeflow.apiBase (e.g. https://api.openai.com or any OpenAI-compatible endpoint).';
  if (!apiKey) return 'Configure codeflow.apiKey.';
  try {
    const u = new URL(apiBase);
    if (u.protocol === 'http:') {
      const h = (u.hostname || '').toLowerCase();
      if (h !== 'localhost' && h !== '127.0.0.1') {
        return 'HTTP is only allowed for localhost/127.0.0.1. Use HTTPS for remote endpoints.';
      }
    }
  } catch {
    return 'codeflow.apiBase must be a valid URL.';
  }
  return null;
}
