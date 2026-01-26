import * as vscode from 'vscode';

const FILE_SYNC_LIMIT_BYTES = 50 * 1024 * 1024;

export async function isFileTooLarge(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.size > FILE_SYNC_LIMIT_BYTES;
  } catch {
    return false;
  }
}
