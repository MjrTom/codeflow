import * as vscode from 'vscode';

let ch: vscode.OutputChannel | undefined;

export function setLogChannel(c: vscode.OutputChannel): void {
  ch = c;
}

export function log(msg: string): void {
  ch?.appendLine(`[Codeflow] ${msg}`);
}
