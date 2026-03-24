# ACP, MCP & Claude Agent SDK — Research Doc

## Table of Contents

1. [What is ACP (Agent Client Protocol)?](#1-what-is-acp-agent-client-protocol)
2. [ACP Architecture](#2-acp-architecture)
3. [What is MCP (Model Context Protocol)?](#3-what-is-mcp-model-context-protocol)
4. [MCP Architecture](#4-mcp-architecture)
5. [ACP vs MCP — Key Differences](#5-acp-vs-mcp--key-differences)
6. [What is the Claude Agent SDK?](#6-what-is-the-claude-agent-sdk)
7. [How All Three Relate](#7-how-all-three-relate)
8. [Is This Available in Claude?](#8-is-this-available-in-claude)
9. [Why Would You Need This?](#9-why-would-you-need-this)
10. [How to Implement MCP](#10-how-to-implement-mcp)
11. [How to Implement the Agent SDK](#11-how-to-implement-the-agent-sdk)
12. [Relevance to This Project](#12-relevance-to-this-project)
13. [Sources](#13-sources)

---

## 1. What is ACP (Agent Client Protocol)?

**ACP** is an open standard created by **Zed Industries** (backed by Block/Square) that lets AI coding agents integrate into any code editor or IDE — without vendor lock-in.

### The Problem ACP Solves

Before ACP, each AI agent was tied to a specific editor:

```
Claude Code  ──only works in──> VS Code (via extension)
GitHub Copilot ──only works in──> VS Code / JetBrains
Cursor AI    ──only works in──> Cursor editor
```

With ACP, any agent can work in any editor:

```
Claude Code ─┐                  ┌──> Zed
Gemini CLI  ─┤── ACP Standard ──├──> JetBrains (IntelliJ, PyCharm)
OpenAI Codex─┤                  ├──> Neovim
Goose       ─┘                  └──> Emacs
```

**One protocol. Any agent. Any editor.**

### How ACP Works

ACP uses **JSON-RPC messaging** between the editor and the agent. The editor sends user instructions, and the agent sends back code edits, suggestions, and responses.

Key message types in ACP:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `session/initialize` | Agent → Editor | Agent declares its capabilities (text, audio, etc.) |
| `session/new` | Both | Establish a new working session |
| `session/prompt` | Editor → Agent | Send user's instruction to the agent |
| `session/update` | Agent → Editor | Agent sends back responses, code changes |
| `session/cancel` | Editor → Agent | User cancels the agent's current work |

### Supported Editors

| Editor | ACP Support |
|--------|------------|
| **Zed** | Native support (creator of ACP) |
| **JetBrains** (IntelliJ, PyCharm, etc.) | In progress |
| **Neovim** | Via CodeCompanion plugin |
| **Emacs** | Via agent-shell plugin |
| **Obsidian** | Side panel chat |

### Supported Agents

| Agent | Creator |
|-------|---------|
| **Claude Code** | Anthropic |
| **Gemini CLI** | Google |
| **Codex** | OpenAI |
| **Goose** | Block (Square) |
| **OpenHands** | Open source |

### Note: Two Things Called "ACP"

There are two different protocols both abbreviated as "ACP":

1. **Agent Client Protocol** (by Zed/Block) — connects agents to **editors/IDEs** (this section)
2. **Agent Communication Protocol** (by IBM) — connects agents to **other agents** (agent-to-agent)

The IBM one has merged with Google's A2A protocol under the Linux Foundation. When people in the dev tools space say "ACP", they usually mean the Zed/Block one.

---

## 2. ACP Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    EDITOR / IDE                          │
│                (Zed, JetBrains, Neovim)                 │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ File Buffer  │  │ Terminal     │  │ UI Panels     │  │
│  │ (code view)  │  │ (output)     │  │ (chat, diff)  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
│         └─────────────────┼─────────────────┘           │
│                           │                              │
│                    ACP Interface                         │
└───────────────────────────┼──────────────────────────────┘
                            │
                      JSON-RPC (ACP)
                            │
┌───────────────────────────┼──────────────────────────────┐
│                      AI AGENT                            │
│              (Claude Code, Gemini, Codex)                │
│                                                          │
│  The agent can:                                          │
│  - Read files from the editor                            │
│  - Make multi-file edits                                 │
│  - Access full codebase context                          │
│  - Show diffs and suggestions                            │
│  - Run terminal commands                                 │
└──────────────────────────────────────────────────────────┘
```

### The Flow

1. User opens an ACP-compatible editor (e.g., Zed)
2. User selects an AI agent (e.g., Claude Code)
3. Editor establishes an ACP session with the agent (`session/initialize`)
4. User types a prompt: "Fix the login bug"
5. Editor sends the prompt to the agent (`session/prompt`)
6. Agent reads files, analyzes code, generates edits
7. Agent sends changes back to the editor (`session/update`)
8. Editor shows the diff to the user for review

### Privacy

ACP prioritizes privacy — when using third-party agents, nothing touches the editor company's servers. Communication is direct between the editor and the agent. No code is stored or used for training without explicit consent.

---

## 3. What is MCP (Model Context Protocol)?

**MCP** is an open-source standard created by Anthropic (Nov 2024) that lets AI applications connect to external tools, data sources, and workflows.

Think of it like a **USB-C port for AI** — just as USB-C gives a standard way to connect devices, MCP gives a standard way to connect AI apps to external systems.

### The Problem MCP Solves

Without MCP, every AI app needs custom integrations for every service:

```
Claude  ──custom code──> GitHub
Claude  ──custom code──> Database
Claude  ──custom code──> Slack
ChatGPT ──custom code──> GitHub    (different implementation!)
ChatGPT ──custom code──> Database  (different implementation!)
```

With MCP, you build one server, and any AI app can use it:

```
Claude  ─┐                ┌──> GitHub MCP Server
ChatGPT ─┤── MCP Standard ├──> Database MCP Server
VS Code ─┘                └──> Slack MCP Server
```

**One protocol. Build once. Works everywhere.**

### Who Uses MCP?

MCP is supported by Claude, ChatGPT, VS Code (Copilot), Cursor, and many more AI tools. In Dec 2025, Anthropic donated MCP to the Linux Foundation's Agentic AI Foundation (co-founded with Block and OpenAI).

---

## 4. MCP Architecture

MCP has three roles:

```
┌─────────────────────────────────────────────────────┐
│  HOST (e.g., Claude Desktop, VS Code, your app)     │
│                                                     │
│   ┌───────────┐   ┌───────────┐   ┌───────────┐    │
│   │  CLIENT 1 │   │  CLIENT 2 │   │  CLIENT 3 │    │
│   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘    │
└─────────┼───────────────┼───────────────┼───────────┘
          │               │               │
    MCP Protocol    MCP Protocol    MCP Protocol
          │               │               │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │  SERVER A  │   │  SERVER B  │   │  SERVER C  │
    │  (GitHub)  │   │ (Database) │   │  (Slack)   │
    └───────────┘   └───────────┘   └───────────┘
```

### Host

The AI application that the user interacts with. It manages multiple MCP clients.

- Examples: Claude Desktop, Claude Code, VS Code, your custom app

### Client

Lives inside the host. Each client maintains a 1:1 connection with one MCP server.

- Handles the protocol communication (sending requests, receiving responses)
- One client per server connection

### Server

Exposes capabilities to the AI through three primitives:

| Primitive | What It Does | Example |
|-----------|-------------|---------|
| **Tools** | Functions the AI can call | `create_issue()`, `query_database()`, `send_message()` |
| **Resources** | Data the AI can read | Files, database records, API responses |
| **Prompts** | Pre-written prompt templates | "Summarize this PR", "Generate SQL for..." |

### Transport Methods

How clients and servers communicate:

| Transport | How It Works | When To Use |
|-----------|-------------|-------------|
| **stdio** | Server runs as a local subprocess, communicates via stdin/stdout | Local tools (file system, local DB) |
| **HTTP + SSE** | Server runs remotely, client connects over HTTP | Remote services (cloud APIs, SaaS) |

---

## 5. ACP vs MCP — Key Differences

These two protocols solve **completely different problems**:

| | ACP (Agent Client Protocol) | MCP (Model Context Protocol) |
|---|----------------------------|------------------------------|
| **Created by** | Zed Industries / Block | Anthropic |
| **Purpose** | Connect AI agents to **editors/IDEs** | Connect AI to **tools & data sources** |
| **Answers** | "**Where** does the agent work?" | "**What** can the agent access?" |
| **Example** | Claude Code works inside Zed editor | Claude reads your PostgreSQL database |
| **Communication** | JSON-RPC (editor ↔ agent) | JSON-RPC (stdio or HTTP) |
| **Direction** | Editor ↔ Agent | Agent ↔ External Service |
| **License** | Apache 2.0 | Open source (Linux Foundation) |

### They Are Complementary, Not Competing

```
┌───────────┐        ACP          ┌──────────────┐        MCP          ┌───────────┐
│           │                     │              │                     │  GitHub   │
│  Zed /    │ ◄── editor ↔ ───► │  Claude Code  │ ◄── agent ↔ ───►  │  Database  │
│  JetBrains│     agent           │   (agent)    │     tools          │  Slack    │
│           │                     │              │                     │  APIs     │
└───────────┘                     └──────────────┘                     └───────────┘

       ACP handles this side              MCP handles this side
     (WHERE agent works)               (WHAT agent can access)
```

### Real-World Analogy

- **ACP** is like the **steering wheel** — it's how you (the editor) control the agent
- **MCP** is like the **engine's fuel lines** — it's how the agent connects to external power (data/tools)

You need both for a fully functional car (AI workflow), but they do different jobs.

---

## 6. What is the Claude Agent SDK?

The **Claude Agent SDK** (formerly Claude Code SDK) is a framework for building AI agents programmatically. It gives you the same tools that power Claude Code — but as a library you can use in your own apps.

### The Core Idea

Instead of writing a tool loop yourself:

```python
# WITHOUT Agent SDK — you handle everything
response = client.messages.create(...)
while response.stop_reason == "tool_use":
    result = your_tool_executor(response.tool_use)  # you implement this
    response = client.messages.create(tool_result=result)
```

The Agent SDK handles the loop for you:

```python
# WITH Agent SDK — Claude handles tools autonomously
async for message in query(prompt="Fix the bug in auth.py"):
    print(message)  # Claude reads, analyzes, edits — all automatic
```

### Built-in Tools

The SDK comes with tools ready to use, no implementation needed:

| Tool | What It Does |
|------|-------------|
| **Read** | Read any file |
| **Write** | Create new files |
| **Edit** | Make precise edits to existing files |
| **Bash** | Run terminal commands |
| **Glob** | Find files by pattern (`**/*.ts`) |
| **Grep** | Search file contents with regex |
| **WebSearch** | Search the web |
| **WebFetch** | Fetch and parse web pages |
| **AskUserQuestion** | Ask the user for input |

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Hooks** | Run custom code at key points (before/after tool use, on stop, etc.) |
| **Subagents** | Spawn specialized agents for focused subtasks |
| **MCP integration** | Connect to any MCP server for external tools |
| **Permissions** | Control exactly which tools the agent can use |
| **Sessions** | Maintain context across multiple exchanges, resume later |

### Available In

- **Python:** `pip install claude-agent-sdk`
- **TypeScript:** `npm install @anthropic-ai/claude-agent-sdk`
- Requires an **Anthropic API key** from https://platform.claude.com

---

## 7. How All Three Relate

```
┌───────────────────────────────────────────────────────────────────────┐
│                         EDITOR / IDE                                  │
│                    (Zed, JetBrains, Neovim)                          │
│                                                                       │
│                         ▲ ACP (Agent Client Protocol)                │
│                         │ "Where the agent works"                    │
└─────────────────────────┼─────────────────────────────────────────────┘
                          │
┌─────────────────────────┼─────────────────────────────────────────────┐
│                    AI AGENT (Claude Code)                              │
│                                                                       │
│   ┌─────────────────────────────────────────────────────────┐         │
│   │              Claude Agent SDK                            │         │
│   │         "How to build/control the agent"                │         │
│   │                                                         │         │
│   │   Built-in: Read, Edit, Bash, Grep, Glob, etc.         │         │
│   │                                                         │         │
│   │   MCP Connections ────────────────────────┐             │         │
│   │   "What the agent can access"             │             │         │
│   └───────────────────────────────────────────┼─────────────┘         │
└───────────────────────────────────────────────┼───────────────────────┘
                                                │
                                    MCP Protocol│
                                                │
                          ┌─────────────────────┼──────────────────┐
                          │                     │                  │
                    ┌─────┴─────┐   ┌───────────┴──┐   ┌──────────┴──┐
                    │  GitHub   │   │   Database   │   │    Slack    │
                    │  Server   │   │   Server     │   │    Server   │
                    └───────────┘   └──────────────┘   └─────────────┘
```

| | ACP | MCP | Claude Agent SDK |
|---|-----|-----|-----------------|
| **What** | A protocol | A protocol | A framework |
| **Purpose** | Connect agents to **editors** | Connect agents to **tools/data** | **Build** autonomous agents |
| **Answers** | Where does the agent work? | What can the agent access? | How do I build an agent? |
| **Created by** | Zed / Block | Anthropic | Anthropic |
| **Scope** | Any agent + any editor | Any AI app + any service | Claude-specific |

**In short:**
- **ACP** = the *interface* between editor and agent (where it works)
- **MCP** = the *protocol* for connecting to external things (what it accesses)
- **Agent SDK** = the *framework* for building agents that use both

---

## 8. Is This Available in Claude?

### MCP — Yes, fully available

| Claude Product | MCP Support |
|---------------|-------------|
| **Claude Code (CLI)** | Yes — `claude mcp add` to add servers |
| **Claude Desktop** | Yes — configure in settings |
| **Claude API** | Yes — via MCP Connector |
| **Claude.ai (web)** | Yes — via Connectors feature |

Example — adding an MCP server in Claude Code:

```bash
# Connect to a PostgreSQL database
claude mcp add --transport stdio mydb -- npx @bytebase/dbhub --dsn "postgresql://localhost/mydb"

# Connect to GitHub
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# Connect to a local filesystem server
claude mcp add --transport stdio files -- npx @anthropic-ai/mcp-server-filesystem /path/to/dir
```

### ACP — Yes, Claude Code supports it

Claude Code is one of the supported ACP agents. It can integrate with:
- **Zed** — native ACP support
- **JetBrains** — ACP integration in progress
- **Neovim** — via CodeCompanion plugin

When you use Claude Code inside an ACP-compatible editor, the editor communicates with Claude Code through the ACP protocol — sending your prompts and receiving code edits back.

### Claude Agent SDK — Yes, fully available

```bash
# TypeScript
npm install @anthropic-ai/claude-agent-sdk

# Python
pip install claude-agent-sdk

# Set your API key
export ANTHROPIC_API_KEY=your-api-key
```

---

## 9. Why Would You Need This?

### When You Need ACP

| Scenario | Why ACP Helps |
|----------|--------------|
| You want Claude Code inside Zed or Neovim | ACP makes it work without custom plugins |
| You're building your own AI coding agent | ACP lets it work in any editor |
| You want to switch editors without losing your AI agent | ACP prevents vendor lock-in |
| You want multiple agents in the same editor | ACP standardizes how they all connect |

### When You Need MCP

| Scenario | Why MCP Helps |
|----------|--------------|
| Claude needs to read your database | MCP server exposes DB queries as tools |
| Claude needs to manage GitHub issues | MCP server wraps GitHub API |
| Claude needs to send Slack messages | MCP server wraps Slack API |
| You want the same integration in Claude AND VS Code | Build one MCP server, works in both |

### When You Need Claude Agent SDK

| Scenario | Why Agent SDK Helps |
|----------|-------------------|
| Building a CI/CD bot that auto-fixes failing tests | Agent reads logs, finds bugs, edits code |
| Building a customer support agent | Agent searches docs, generates responses |
| Building a code review pipeline | Agent analyzes PRs, writes review comments |
| Automating repetitive dev tasks | Agent runs commands, edits files, verifies |

### When You Need Both

Building a **production agent** that needs to **interact with external services**:

```python
# Agent that reviews PRs and posts comments to GitHub
async for message in query(
    prompt="Review the latest PR and post your feedback",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Glob", "Grep", "Agent"],
        mcp_servers={
            "github": {"command": "npx", "args": ["@anthropic-ai/mcp-server-github"]}
        }
    ),
):
    print(message)
```

---

## 10. How to Implement MCP

### Option A: Use an Existing MCP Server

Thousands of community-built servers exist. Just connect:

```bash
# In Claude Code
claude mcp add --transport stdio <name> -- <command>

# Examples
claude mcp add --transport stdio postgres -- npx @bytebase/dbhub --dsn "postgresql://..."
claude mcp add --transport stdio playwright -- npx @playwright/mcp@latest
```

### Option B: Build Your Own MCP Server

If you need to expose your own API or data:

**TypeScript example** — a simple MCP server with one tool:

```typescript
// my-mcp-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "employee-lookup",
  version: "1.0.0",
});

// Expose a tool that Claude can call
server.tool(
  "lookup_employee",                          // tool name
  "Look up an employee by ID or name",        // description
  { query: { type: "string" } },              // input schema
  async ({ query }) => {
    // Your logic here — query a DB, API, etc.
    const result = await findEmployee(query);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
```

Install the SDK:

```bash
npm install @modelcontextprotocol/sdk
```

Connect it to Claude Code:

```bash
claude mcp add --transport stdio employee-lookup -- npx tsx my-mcp-server.ts
```

Now Claude can call `lookup_employee("John")` during conversations.

### Option C: Expose Resources (Read-Only Data)

```typescript
server.resource(
  "employee://list",
  "All employees in the system",
  async () => {
    const employees = await getAllEmployees();
    return {
      contents: [{ uri: "employee://list", text: JSON.stringify(employees) }],
    };
  }
);
```

---

## 11. How to Implement the Agent SDK

### Step 1: Install

```bash
# TypeScript
npm install @anthropic-ai/claude-agent-sdk

# Python
pip install claude-agent-sdk
```

### Step 2: Set API Key

```bash
export ANTHROPIC_API_KEY=your-api-key
```

Get a key from https://platform.claude.com

### Step 3: Basic Agent (TypeScript)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Simple agent that reads and analyzes files
for await (const message of query({
  prompt: "What files are in this directory?",
  options: { allowedTools: ["Bash", "Glob"] }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Step 4: Agent with MCP Server

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Check my database for duplicate employee records",
  options: {
    allowedTools: ["Read", "Bash"],
    mcpServers: {
      postgres: {
        command: "npx",
        args: ["@bytebase/dbhub", "--dsn", "postgresql://localhost/employees"]
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Step 5: Agent with Custom Subagents

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Use the validator agent to check all employee records",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Agent"],
    agents: {
      "validator": {
        description: "Validates employee data for completeness and consistency.",
        prompt: "Check each employee record for missing fields and invalid data.",
        tools: ["Read", "Glob", "Grep"]
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Step 6: Agent with Hooks (Audit Logging)

```typescript
import { query, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { appendFile } from "fs/promises";

const logChanges: HookCallback = async (input) => {
  const filePath = (input as any).tool_input?.file_path ?? "unknown";
  await appendFile("./audit.log", `${new Date().toISOString()}: modified ${filePath}\n`);
  return {};
};

for await (const message of query({
  prompt: "Refactor the storage module",
  options: {
    permissionMode: "acceptEdits",
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write", hooks: [logChanges] }]
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

---

## 12. Relevance to This Project

The Employee Data Manager currently uses **localStorage** for everything. MCP and the Agent SDK aren't needed for the current MVP. But here's when they would become relevant:

| Future Scenario | What You'd Use |
|-----------------|---------------|
| Move data from localStorage to a real database (PostgreSQL, SQLite) | **MCP server** to let Claude query/manage the DB |
| Build a CI bot that auto-reviews PRs for this project | **Agent SDK** with GitHub MCP server |
| Let Claude auto-generate employee reports | **Agent SDK** with file system tools |
| Connect to an HR system (BambooHR, Workday) | **MCP server** wrapping the HR API |
| Build an AI assistant inside the Tauri app itself | **Anthropic Client SDK** (direct API calls from Rust/JS) |

### For Now

The current stack (Tauri + React + localStorage) doesn't need MCP or the Agent SDK. These become valuable when you want to:

1. **Extend Claude's capabilities** with your own tools/data → use MCP
2. **Build autonomous AI agents** as part of your product → use Agent SDK
3. **Both** → combine them

---

## 13. Sources

- [Zed — Agent Client Protocol](https://zed.dev/acp)
- [Intro to Agent Client Protocol (ACP) — Goose/Block](https://block.github.io/goose/blog/2025/10/24/intro-to-agent-client-protocol-acp/)
- [JetBrains — Agent Client Protocol](https://www.jetbrains.com/help/ai-assistant/acp.html)
- [Survey of Agent Interoperability Protocols (arXiv)](https://arxiv.org/abs/2505.02279)
- [IBM — Agent Communication Protocol](https://www.ibm.com/think/topics/agent-communication-protocol)
- [Model Context Protocol — Official Site](https://modelcontextprotocol.io/introduction)
- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25)
- [Anthropic: Introducing MCP](https://www.anthropic.com/news/model-context-protocol)
- [Claude Agent SDK — Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK — Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [Building Agents with Claude Agent SDK (Anthropic Blog)](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [MCP GitHub Repository](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [Claude Agent SDK Demos](https://github.com/anthropics/claude-agent-sdk-demos)
