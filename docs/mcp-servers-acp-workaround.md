# MCP Servers — ACP Workaround

## The Problem

`claude-code-acp@0.1.1` (the bridge between Agent Creator and Claude Code) does **not** support MCP server registration through the `session/new` RPC call. If you pass any servers in that call, it throws:

```
ACP error -32600: MCP servers not implemented in this version.
Found 1 server(s). Please remove from configuration.
```

This means we cannot use the standard ACP protocol to tell Claude Code which MCP servers to use at runtime.

## Why MCP Servers Are Needed

Agents like `react-development-using-shadcn-mcp` rely on MCP (Model Context Protocol) servers to access external tools. The **shadcn MCP server** (`npx shadcn@latest mcp`) provides tools for:

- Browsing the shadcn/ui component registry
- Installing components into a project
- Checking which components are already installed

Without the MCP server, Claude cannot access these tools when running a task through Agent Creator's task runner.

## The Workaround

Claude Code (the underlying process that `claude-code-acp` wraps) **does** natively support MCP servers — it reads them from settings files on startup:

| File | Scope |
|------|-------|
| `~/.claude/settings.json` | Global — applies to all sessions |
| `{project}/.claude/settings.json` | Project — checked into git |
| `{project}/.claude/settings.local.json` | Local — gitignored, safe for per-machine overrides |

Since Agent Creator spawns a **fresh** `npx claude-code-acp` process for every task (via `acp_shutdown` + `acp_initialize`), we can write the agent's MCP server config to `{cwd}/.claude/settings.local.json` **before** the process starts. Claude Code will then read this file on startup and register the MCP servers.

## How It Works in Code

In `src-tauri/src/acp/commands.rs`, inside `acp_initialize`:

```
1. Receive mcp_servers from frontend (agent config) and cwd (project path)
2. If mcp_servers is non-empty AND cwd is a valid project path:
   a. Read existing {cwd}/.claude/settings.local.json (if any)
   b. Merge the agent's MCP servers into the "mcpServers" key
   c. Write back to {cwd}/.claude/settings.local.json
3. Spawn `npx claude-code-acp` — Claude Code reads settings.local.json on startup
4. Send session/new with mcpServers: [] (empty, to avoid -32600 error)
5. Claude Code initializes with MCP servers loaded from the settings file
```

## The settings.local.json Format

```json
{
  "mcpServers": {
    "shadcn": {
      "type": "stdio",
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

This matches Claude Code's native settings format. The file is gitignored by default (`.claude/settings.local.json` is in Claude Code's `.gitignore`).

## Two Separate MCP Configs

It's important to understand that MCP servers appear in **two places** in Agent Creator:

| Location | Purpose | Format |
|----------|---------|--------|
| `{project}/.claude/agents/{slug}.md` frontmatter | For Claude Code CLI / sub-agents | YAML object map |
| `{project}/.claude/settings.local.json` | For Agent Creator task runner (this workaround) | JSON object map |

The `.md` file is for when you run agents directly from Claude Code CLI. The `settings.local.json` is for when you run tasks through Agent Creator's UI.

## Expected Behavior After the Fix

When you run a task with an agent that has MCP servers configured:

1. `settings.local.json` is written before the ACP process starts
2. The console init message shows `"mcp_servers": ["shadcn"]` (not `[]`)
3. Claude can use shadcn MCP tools during the task

## Limitations

- MCP servers are written to the **project directory**. Tasks run without a project path (global tasks) will not have MCP servers.
- The `settings.local.json` file persists on disk after the task completes. This is intentional — the file acts as the project's agent MCP configuration.
- If the agent's MCP configuration changes, the next task run will overwrite the `mcpServers` key in `settings.local.json`.

## Future

Once `claude-code-acp` adds native MCP server support to `session/new`, this workaround can be replaced by passing servers directly in the protocol call.
