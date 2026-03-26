# ACP Limitations — Model Selection, Auth Modes & cwd

## Overview

This document explains the constraints discovered while integrating `claude-code-acp` into the Agent Creator app. The key finding: **model selection does not work when using Claude Code subscription auth**. This affects every agent regardless of which model is configured in the UI.

---

## Auth Modes

The app supports two ways to connect to Claude via ACP:

| Mode | Subprocess | Auth Source | Model Control |
|---|---|---|---|
| **Subscription** (current) | `npx claude-code-acp` | Claude Code CLI login | ❌ Broken — see known bug below |
| **API Key** (commented out) | `claude-code-acp-rs` | `ANTHROPIC_API_KEY` in `.env` | ⚠️ May be honoured — not yet verified |

The spawn logic is in `src-tauri/src/acp/commands.rs`. The API key path is currently commented out.

---

## Why Model Selection Fails — Known Bug

### Evidence (actual init notification received)

```json
{
  "type": "system",
  "subtype": "init",
  "model": "claude-sonnet-4-20250514",
  "apiKeySource": "none",
  "cwd": "/Users/mani/Projects/Learning/Tauri_mvp_app/src-tauri"
}
```

- `"apiKeySource": "none"` — subscription auth, no API key
- `"model": "claude-sonnet-4-20250514"` — sonnet used regardless of agent config (e.g. haiku selected)

### Root cause

**`claude-code-acp` Issue #225** (zed-industries/claude-code-acp): The package always selects the **first model from its internal `supportedModels()` array**, ignoring:
- The `model` field in `session/new` JSON-RPC params (not officially spec'd)
- The `ANTHROPIC_MODEL` environment variable
- User model configuration in `~/.claude/settings.json`

This is a bug in the npm package itself, not in our integration code.

---

## Official Model Override Methods (Claude Code CLI)

Priority order from highest to lowest:

| Method | How | Works with ACP? |
|---|---|---|
| In-session command | `/model <alias>` | ❌ Interactive only |
| CLI flag | `--model claude-haiku-4-5-20251001` | ❌ Not applicable to subprocess |
| **Env var** | `ANTHROPIC_MODEL=claude-haiku-4-5-20251001` | ⚠️ Blocked by Issue #225 |
| **Version-specific env vars** | `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` | ⚠️ Untested |
| Settings file | `model` in `~/.claude/settings.json` | ❌ Blocked by Issue #225 |

Source: [code.claude.com/docs/en/model-config](https://code.claude.com/docs/en/model-config)

---

## Paths to Fix Model Selection

| Option | Effort | Notes |
|---|---|---|
| Pass `ANTHROPIC_MODEL` env var at spawn | Low | Official approach but blocked by Issue #225 in current package version |
| Pass `ANTHROPIC_DEFAULT_HAIKU_MODEL` etc. at spawn | Low | Version-specific vars — worth trying, less likely to be affected by the bug |
| Switch to `claude-agent-acp` package | Medium | Recommended successor to `claude-code-acp`; ACP compatibility needs testing |
| Use `ANTHROPIC_API_KEY` + `claude-code-acp-rs` | Medium | Requires API key from console.anthropic.com; most reliable path |

---

## cwd: Two Different Values

### 1. Subprocess cwd (shown in init message)
- Value: `/Users/mani/Projects/Learning/Tauri_mvp_app/src-tauri`
- Source: OS — working directory of the Tauri binary at spawn time
- **We do not control this** — inherited from the Tauri process

### 2. Session cwd (set in session/new)
- Value: `$HOME` (e.g. `/Users/mani`)
- Source: `commands.rs` → `session/new` params
- **We control this** — set to `$HOME` so Claude doesn't read the app's source files

These two are independent. The subprocess cwd shown in the init message is informational only — the session cwd correctly sets Claude's working context.

---

## What Actually Works Today (Subscription Auth)

| Feature | Status | Notes |
|---|---|---|
| Connect to Claude | ✅ | Via `npx claude-code-acp` |
| Streaming responses | ✅ | Via `session/update` notifications |
| MCP servers | ✅ | Passed via `session/new` mcpServers |
| System prompt | ✅ (partial) | Prepended to each task as user turn — Claude Code identity still present |
| Session cwd | ✅ | Set to `$HOME` |
| Model selection | ❌ | Blocked by `claude-code-acp` Issue #225 — always uses sonnet |
| Cancel | ✅ | Via `session/cancel` notification |

---

## What the Model Badge in the UI Means

The model badge on task result cards shows the model **configured on the agent** — the *requested* model, not the *actual* model used. Until model selection is fixed, treat it as a label only. Verify the actual model from the `modelUsage` field in the console output.

---

## How to Enable Model Selection (Future)

### Option A — API key (most reliable)
1. Get an Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
2. Create `src-tauri/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Install: `cargo install claude-code-acp-rs`
4. In `commands.rs`, uncomment the API key branch and verify model is honoured

### Option B — Switch to `claude-agent-acp`
1. Replace `npx claude-code-acp` with `npx claude-agent-acp` in the spawn command
2. Test whether model selection works in this package
3. Verify ACP protocol compatibility (initialize, session/new, session/prompt)
