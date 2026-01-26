# Codeflow

Codeflow is a VS Code extension that turns a messy codebase into a clean outline. It reads symbols from your workspace, asks your LLM, and gives you a flow you can click through. It's basically a replica of Windsurf's CodeMaps feature, which now you can use it on any vscode fork with any endpoint!

I built it purely for personal reasons but obviously, if you want to contribute with improvements, feel free to do so!

## What you get

- A dedicated Codeflow view in the Activity Bar.
- Clickable steps that jump to the relevant file and line.
- A graph view (Mermaid) with diagrams when you want the big picture.
- Export to JSON or HTML for sharing.
- Works with any OpenAI-compatible endpoint.

## Quick start

1. Open a workspace folder.
2. Set `codeflow.apiBase` and `codeflow.apiKey` in Settings.
3. Run **Codeflow: Create Codeflow**.
4. Ask a question like "Where does auth start?" or "Startup flow".

## Settings

| Setting | Description | Example |
|---------|-------------|---------|
| `codeflow.apiBase` | Base URL of the API. If it ends with a version (e.g. `/v4`), we append `/chat/completions`; otherwise `/v1/chat/completions`. | `https://api.openai.com` |
| `codeflow.apiKey` | API key for the provider. | `sk-...` |
| `codeflow.model` | Model name. | `modelname` |
| `codeflow.maxTokens` | Max tokens for responses. | `4096` |
| `codeflow.timeoutMs` | Client timeout (ms). `0` disables the client timeout. | `0` |
| `codeflow.include` | Glob for files to consider. | `**/*.{ts,tsx,js,jsx,py,go,rs,java,kt}` |
| `codeflow.exclude` | Glob to exclude. | `**/node_modules/**,**/.git/**,**/dist/**` |

Notes:
- HTTP is only allowed for `localhost` / `127.0.0.1`.
- The API must expose `POST /v1/chat/completions` (OpenAI-compatible) (TLDR: Just get an OpenAI compatible endpoint!).

## Commands

- `Codeflow: Create Codeflow`
- `Codeflow: Refresh Codeflow`
- `Codeflow: Open as Graph`
- `Codeflow: Export as JSON`
- `Codeflow: Export as HTML`
- `Codeflow: Focus on Codeflow View`

## Development

```bash
npm install
npm run compile
```

## License

MIT
