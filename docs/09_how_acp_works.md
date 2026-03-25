# How ACP Works in This Project

## What Is ACP?

ACP (Agent Communication Protocol) lets a client app talk to an AI agent (Claude) over **JSON-RPC 2.0 via stdio**. Your Tauri app spawns a Claude Code subprocess, pipes JSON messages through stdin/stdout, and gets back streaming text. Think of it as a structured pipe between your app and Claude.

---

## Architecture

```
┌─────────────┐   invoke()    ┌──────────────┐   stdin (JSON-RPC)   ┌─────────────────┐
│  React UI   │ ────────────▶ │  Rust/Tauri   │ ──────────────────▶ │  Claude Code     │
│  (useChat)  │               │  (commands.rs)│                     │  ACP subprocess  │
│             │ ◀──────────── │              │ ◀────────────────── │                  │
│             │  Tauri events │  (reader.rs)  │  stdout (JSON-RPC)  │                  │
└─────────────┘  acp:message  └──────────────┘                     └─────────────────┘
                  -chunk
```

**Three layers:**
1. **React frontend** — calls Tauri commands, listens for events
2. **Rust backend** — manages the subprocess, sends/receives JSON-RPC
3. **Claude Code ACP** — the AI agent process (either `claude-code-acp-rs` or `npx claude-code-acp`)

---

## How Rust Connects to Claude via ACP

There's no HTTP call, no WebSocket, no TCP port. The Rust app **spawns a child process** and talks through stdin/stdout pipes.

### Step 1: Spawn the subprocess (`commands.rs` line 118-151)

```rust
// Option A: If ANTHROPIC_API_KEY exists in .env
Command::new("claude-code-acp-rs")       // ← This IS the ACP agent binary
    .env("ANTHROPIC_API_KEY", &api_key)
    .stdin(Stdio::piped())               // ← We write JSON into this
    .stdout(Stdio::piped())              // ← We read JSON from this
    .spawn()

// Option B: No API key — fall back to Claude CLI auth
Command::new("npx")
    .arg("claude-code-acp")             // ← Node.js version of the same agent
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()
```

### Step 2: Grab the pipes

```rust
let stdin = child.stdin.take();   // write JSON here → goes to Claude
let stdout = child.stdout.take(); // read JSON from here ← comes from Claude
```

### Step 3: Handshake over those pipes

```rust
// "Hello, I'm a client"
send_request(&stdin, ..., "initialize", params).await;

// "Create a session"
send_request(&stdin, ..., "session/new", params).await;
// Response: { "result": { "sessionId": "abc123" } }
```

### Step 4: Background reader loops on stdout forever

```rust
// reader.rs — runs in a tokio::spawn task
let mut lines = BufReader::new(stdout).lines();
while let Ok(Some(line)) = lines.next_line().await {
    // every line from stdout is one JSON-RPC message from Claude
    let incoming: JsonRpcIncoming = serde_json::from_str(&line);
    // classify and route it...
}
```

### Connection Timeline

```
Your Rust app                          claude-code-acp-rs
    │                                        │
    │  spawn process                         │
    │ ──────────────────────────────────────▶ │ (process starts)
    │                                        │
    │  stdin: {"method":"initialize",...}     │
    │ ──────────────────────────────────────▶ │
    │  stdout: {"result":{...}}              │
    │ ◀────────────────────────────────────── │
    │                                        │
    │  stdin: {"method":"session/new",...}    │
    │ ──────────────────────────────────────▶ │
    │  stdout: {"result":{"sessionId":"x"}}  │
    │ ◀────────────────────────────────────── │
    │                                        │
    │  stdin: {"method":"session/prompt",...} │
    │ ──────────────────────────────────────▶ │
    │                                        │  Claude thinks...
    │  stdout: {"method":"session/update"}   │
    │ ◀────────────────────────────────────── │  (chunk 1)
    │  stdout: {"method":"session/update"}   │
    │ ◀────────────────────────────────────── │  (chunk 2)
    │  stdout: {"id":3,"result":{...}}       │
    │ ◀────────────────────────────────────── │  (done)
```

### What is `claude-code-acp-rs`?

It's a **separate binary** (not part of your code) that:
1. Listens on stdin for JSON-RPC messages
2. Talks to Claude's HTTP API internally (using your API key)
3. Runs tools, manages conversation turns
4. Writes JSON-RPC responses/notifications to stdout

Your Rust code never calls Claude's API directly. It talks to this middleman process which does all the heavy lifting.

### Connection Summary

| Question | Answer |
|---|---|
| **Where?** | `commands.rs` line 120 — `Command::new("claude-code-acp-rs").spawn()` |
| **How?** | Spawns a child process, pipes stdin/stdout |
| **Protocol?** | JSON-RPC 2.0, one JSON object per line |
| **Who calls Claude's API?** | The subprocess, not your Rust code |
| **What's the pipe?** | OS-level stdin/stdout — same as `echo "hi" \| cat` |

---

## The Protocol: 6 Message Types

Every message follows JSON-RPC 2.0. There are exactly **6 message types** used in this app:

### 1. `initialize` — Handshake

Client tells the agent who it is. Agent responds with capabilities.

```
Client → Agent
```
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {},
    "clientInfo": { "name": "agent-creator", "version": "0.1.0" }
  }
}
```
```
Agent → Client
```
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "protocolVersion": 1, "agentCapabilities": {}, "agentInfo": {} }
}
```

### 2. `session/new` — Create a Session

Creates a conversation session. Returns a `sessionId` used for all subsequent messages.

```
Client → Agent
```
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": { "cwd": "/path/to/project", "mcpServers": [] }
}
```
```
Agent → Client
```
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": { "sessionId": "abc123" }
}
```

### 3. `session/prompt` — Send a Message

Sends the user's text to Claude. This is a **request** — the final response arrives when Claude finishes. Meanwhile, streaming chunks come as separate notifications (see #4).

```
Client → Agent
```
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "abc123",
    "prompt": [{ "type": "text", "text": "What's the weather in Tokyo?" }]
  }
}
```
```
Agent → Client (final response, after all streaming is done)
```
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": { "stopReason": "end_turn" }
}
```

### 4. `session/update` — Streaming Chunks (Notification)

As Claude generates text, the agent sends **notifications** (no `id`, no response expected). These arrive between the prompt request and the final response.

```
Agent → Client (multiple times)
```
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "update": {
      "type": "AgentMessageChunk",
      "content": { "text": "The weather in Tokyo is..." }
    }
  }
}
```

### 5. `session/cancel` — Stop Generation (Notification)

Client tells the agent to stop generating. No response expected.

```
Client → Agent
```
```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": { "sessionId": "abc123" }
}
```

### 6. `session/request_permission` — Tool Permission (Agent Request)

When Claude wants to use a tool (web search, file read, etc.), the agent asks the client for permission. This app **auto-approves** all requests.

```
Agent → Client
```
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "session/request_permission",
  "params": { "permission": "web_search", ... }
}
```
```
Client → Agent (auto-approved)
```
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": { "outcome": "allow_once" }
}
```

---

## How Streaming Works End-to-End

```
1. User types "What's the weather?"
2. React calls: invoke("acp_send_prompt", { message: "What's the weather?" })
3. Rust sends session/prompt JSON to subprocess stdin
4. Claude starts generating...
5. Subprocess writes session/update notifications to stdout (one per chunk)
6. Rust reader.rs reads each line, extracts text, emits Tauri event:
     app.emit("acp:message-chunk", { text: "The weather...", done: false })
7. React listener appends text to the assistant message in state
8. ...more chunks arrive and get appended...
9. Subprocess writes the final response (id: 3, result: {...})
10. Rust matches id=3 to the pending request, unblocks acp_send_prompt
11. Rust emits final event: { text: "", done: true }
12. React marks the message as no longer streaming
```

**Key insight:** Streaming chunks (`session/update`) and the final response (`session/prompt` result) are separate. Chunks are notifications (no `id`), the final response has the original request `id`.

---

## How Request-Response Correlation Works

The Rust backend uses a **pending map** pattern:

1. Each outgoing request gets a unique `id` (atomic counter)
2. A oneshot channel `(sender, receiver)` is created
3. The sender is stored in a `HashMap<u64, Sender>` keyed by `id`
4. The request is written to stdin
5. The caller `await`s the receiver
6. When the reader task sees a response with that `id`, it removes the sender from the map and sends the result through it
7. The original caller unblocks

This allows multiple concurrent requests (though the frontend sends one at a time).

---

## What's Used in This Project

### Rust Crates
| Crate | Purpose |
|-------|---------|
| `tokio` | Async runtime, subprocess I/O, mutexes, channels |
| `serde` / `serde_json` | JSON serialization of all JSON-RPC messages |
| `dotenvy` | Load `.env` file for `ANTHROPIC_API_KEY` |
| `tauri` | IPC commands, event emission, app lifecycle |

### Tauri APIs
| API | Where Used |
|-----|-----------|
| `#[tauri::command]` | `acp_initialize`, `acp_send_prompt`, `acp_cancel`, `acp_shutdown` |
| `AppHandle::emit()` | Emits `acp:message-chunk` and `acp:disconnected` events |
| `State<AcpState>` | Shared subprocess state across commands |
| `invoke()` (frontend) | React calls Rust commands |
| `listen()` (frontend) | React listens for streaming events |

### Key Files
| File | Role |
|------|------|
| `src-tauri/src/acp/commands.rs` | Tauri commands — init, prompt, cancel, shutdown |
| `src-tauri/src/acp/reader.rs` | Background task reading stdout, dispatching messages |
| `src-tauri/src/acp/types.rs` | JSON-RPC types, message classifier, event payload |
| `src-tauri/src/acp/state.rs` | Shared state: subprocess, stdin, pending map, session |
| `src/hooks/useChat.ts` | React hook — calls commands, listens for chunk events |

---

## Message Classification Logic

Every line from stdout is deserialized as `JsonRpcIncoming` and classified:

```
Has id + method?  → AgentRequest  (agent asking us something)
Has id + error?   → ErrorResponse (our request failed)
Has id + result?  → Response      (our request succeeded)
Has method only?  → Notification  (streaming chunk, no response needed)
```

This is handled by `JsonRpcIncoming::classify()` in `types.rs`.

---

## Why ACP Instead of the HTTP API?

Anthropic already provides a direct HTTP API (`api.anthropic.com`). So why use ACP?

**The HTTP API gives you Claude's brain.** You send a prompt, get a response. If Claude says "I need to read a file" or "I need to call a tool", *your code* has to execute that tool and send the result back. You build the entire agent loop yourself — tool execution, multi-turn management, MCP connections, permission handling.

**ACP gives you Claude Code as a full agent.** It already has the brain *and* the hands. It reads files, runs commands, calls MCP tools, and manages multi-turn tool loops — all on its own. You just send a task and stream the output.

```
HTTP API:   You  →  Claude (brain only)  →  You handle tools yourself
ACP:        You  →  Claude Code (brain + hands)  →  Agent does the work, streams back
```

### Comparison

| | HTTP API | ACP |
|---|---|---|
| What you get | Claude model responses | Claude Code (full autonomous agent) |
| Tool execution | You build it | Built-in |
| MCP server support | You build a client | Pass config at init, agent connects |
| Multi-turn tool loops | You build the loop | Automatic |
| Permission system | N/A | Built-in request/approve flow |
| Streaming | SSE from API | JSON-RPC notifications over stdio |
| Auth | API key directly | API key or Claude CLI login |
| Best for | Custom pipelines, fine-grained control | Agent apps that need tool use |

### Why This Project Uses ACP

This app creates **custom agents with different MCP servers**. Each agent might connect to databases, APIs, or local tools. With ACP:

1. Pass `mcpServers` config during `acp_initialize` — agent connects automatically
2. Claude Code handles all tool execution internally
3. Permission requests flow back via `session/request_permission`
4. Your app just streams text output to the UI

Building the same thing with the HTTP API would mean writing your own tool execution engine, MCP client, multi-turn orchestration loop, and permission system from scratch.

---

## Research References

- [HTTP API vs ACP research notes (ChatGPT)](https://chatgpt.com/share/69c3affc-6160-83aa-9c23-053563e216d2)
