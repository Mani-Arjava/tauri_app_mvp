# ACP Architecture — How Agent Creator Works

> This document explains how React talks to Claude AI through our Rust backend, step by step.

---

## 1. The Big Picture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Creator App                            │
│                                                                     │
│   ┌──────────────┐   invoke/listen   ┌──────────────────────────┐  │
│   │   React UI   │ ◄───────────────► │   Rust Backend (Tauri)   │  │
│   │              │                   │   src-tauri/src/acp/     │  │
│   └──────────────┘                   └──────────────┬───────────┘  │
│                                                      │ stdin/stdout │
│                                          ┌───────────▼───────────┐  │
│                                          │  npx claude-code-acp  │  │
│                                          │  (ACP bridge process) │  │
│                                          └───────────┬───────────┘  │
│                                                      │ internal     │
│                                          ┌───────────▼───────────┐  │
│                                          │     Claude Code CLI   │  │
│                                          │  + MCP tools (files,  │  │
│                                          │    bash, shadcn...)   │  │
│                                          └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Simple rule:** React never talks to Claude directly. It always goes through Rust, which manages a child process (`npx claude-code-acp`). That child process talks to Claude Code, which does the actual AI work and tool execution.

---

## 2. Three Layers Explained

### Layer 1 — React UI
**File:** `src/hooks/useTaskRunner.ts`

The UI's job is simple:
- Send tasks to Rust using `invoke()`
- Listen for streaming text using `listen()`
- Show results to the user

```typescript
// Send a task to Rust
await invoke("acp_send_prompt", { message: "Build a todo app" });

// Listen for streaming text chunks from Claude
listen("acp:message-chunk", (event) => {
  console.log(event.payload.text); // streaming text from Claude
  console.log(event.payload.done); // true when Claude is finished
});
```

---

### Layer 2 — Rust ACP Bridge
**Files:** `src-tauri/src/acp/`

Rust is the manager. It:
1. Spawns and kills the `claude-code-acp` process
2. Sends JSON-RPC messages to it via **stdin**
3. Reads responses from it via **stdout**
4. Forwards streaming text to React as Tauri events

**Files in `src-tauri/src/acp/`:**

| File | What it does |
|------|-------------|
| `commands.rs` | All Tauri commands callable from React (`acp_initialize`, `acp_send_prompt`, etc.) |
| `reader.rs` | Background task that reads stdout of the ACP process and routes messages |
| `state.rs` | Shared state held in memory (child process handle, session ID, pending requests) |
| `types.rs` | Data structures for JSON-RPC messages |

---

### Layer 3 — claude-code-acp
**Started by:** `npx claude-code-acp` (Node.js subprocess)

This is an **ACP protocol server** that wraps Claude Code CLI. It:
- Receives JSON-RPC messages from our Rust bridge via stdin
- Forwards prompts to Claude Code
- Streams Claude's responses back via stdout
- Handles MCP tool calls (file read/write, bash, shadcn) internally

**We do not modify this.** We only communicate with it using the ACP protocol.

> **Important — Who owns the AI server?**
> `claude-code-acp` connects to **Anthropic's servers** (the same infrastructure behind claude.ai). We do NOT run or host any AI server. Auth is via `claude login` (Claude Code CLI) — your personal subscription token is used. We have no control over which model runs or what the API call costs.

---

## 3. The ACP Protocol — JSON-RPC Over Stdio

All communication between Rust and `claude-code-acp` uses **JSON-RPC 2.0** — one JSON object per line, sent over stdin/stdout.

### Message Types

#### Type 1: Request (Rust → ACP) — expects a response
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/prompt",
  "params": {
    "sessionId": "abc-123",
    "prompt": [{ "type": "text", "text": "Build a todo app" }]
  }
}
```
> We send a unique `id`. We wait for a response with the same `id`.

#### Type 2: Response (ACP → Rust) — reply to our request
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "sessionId": "abc-123" }
}
```
> ACP sends back the same `id` with the result.

#### Type 3: Notification (ACP → Rust) — no response needed
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "abc-123",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "text": "Here's the plan..." }
    }
  }
}
```
> ACP streams Claude's text as notifications. No `id` field = no response needed.

#### Type 4: AgentRequest (ACP → Rust) — ACP asks US for something
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/request_permission",
  "params": { "tool": "Bash", "input": { "command": "npm create vite@latest" } }
}
```
> ACP asks if Claude can run a command. We respond with allow/deny.

---

## 4. All ACP Operations

### Operation 1: `acp_initialize` — Start a session

**Called from React when:**
- User runs first task
- User switches to a different agent or project

**What it does (in order):**

```
Step 1: Write {cwd}/.claude/settings.local.json
        → Sets permissions.allow so Claude can run bash/write files freely
        → Sets mcpServers so Claude has extra tools (shadcn, etc.)

Step 2: Spawn "npx claude-code-acp" as a child process
        → stdin = pipe (we write to it)
        → stdout = pipe (we read from it)
        → stderr = inherit (errors show in terminal)

Step 3: Start background reader task
        → Reads stdout lines in a loop
        → Routes messages to the right place

Step 4: Send "initialize" request (handshake)
        → Tells ACP who we are
        → Waits for response

Step 5: Send "session/new" request
        → Creates a new Claude conversation
        → Gets back a sessionId (e.g. "abc-123")
        → We store this ID for all future prompts
```

**Rust code location:** `src-tauri/src/acp/commands.rs` → `acp_initialize()`

---

### Operation 2: `acp_send_prompt` — Send a task to Claude

**Called from React when:** User clicks "Run Task"

**What it does:**

```
Step 1: Build the JSON-RPC request
        {
          "jsonrpc": "2.0",
          "id": 42,          ← auto-incrementing number
          "method": "session/prompt",
          "params": {
            "sessionId": "abc-123",
            "prompt": [{ "type": "text", "text": "Build a todo app" }]
          }
        }

Step 2: Register a "waiting channel" for this id
        → pending map: { 42: oneshot_sender }
        → This is how we'll know when the response arrives

Step 3: Write the JSON line to stdin of claude-code-acp
        (Claude starts processing the task)

Step 4: Wait for the response
        → Meanwhile, streaming chunks arrive as "session/update" notifications
        → The reader routes those to React as "acp:message-chunk" events
        → React shows text as it streams

Step 5: Response arrives with id=42
        → Reader finds our waiting channel → sends the result
        → acp_send_prompt() returns to React
        → React emits "done" event
```

**Rust code location:** `src-tauri/src/acp/commands.rs` → `acp_send_prompt()`

---

### Operation 3: `acp_cancel` — Stop Claude mid-task

**Called from React when:** User clicks "Cancel"

```
Send notification (no response expected):
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": { "sessionId": "abc-123" }
}
```

**Rust code location:** `src-tauri/src/acp/commands.rs` → `acp_cancel()`

---

### Operation 4: `acp_shutdown` — End the session

**Called from React when:**
- Switching to different agent/project
- User clicks "New Session"
- App window closes

```
Step 1: Abort the background reader task
Step 2: Drop stdin → tells ACP process to exit
Step 3: Kill the child process (force if needed)
Step 4: Remove state from memory
```

**Rust code location:** `src-tauri/src/acp/commands.rs` → `acp_shutdown()`

---

### Operation 5: `acp_is_active` — Check if session is alive

**Called from React before every task** to decide if we need a new session.

```rust
// Returns true only if the reader task is still running
// (reader exits when the ACP process exits)
!inner.reader_handle.is_finished()
```

> **Why not just check if the process exists?** The Rust state (`AcpInner`) stays in memory even after the process dies. Checking `reader_handle.is_finished()` is the reliable way to know the process is truly alive.

---

## 5. Streaming Flow — Step by Step

How does Claude's text get from Claude's brain to the React UI?

```
Claude generates: "Here's step 1..."
        ↓
ACP writes to stdout:
  {"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"text":"Here's step 1..."}}}}
        ↓
Rust reader.rs: reads the line, parses JSON
  → method == "session/update" → extract text chunk
  → app_handle.emit("acp:message-chunk", { text: "Here's step 1...", done: false })
        ↓
React listener in useTaskRunner.ts:
  → event.payload.done == false
  → append text to current streaming result
  → React re-renders → user sees text appear
        ↓
When Claude finishes: ACP sends the final session/prompt Response
  → reader resolves the oneshot channel
  → acp_send_prompt() emits { text: "", done: true }
  → React: mark result as complete
```

---

## 6. Conversation History — Why We Inject It Manually

**The problem:** `claude-code-acp` does NOT remember previous prompts. Every `session/prompt` call starts a fresh Claude conversation, even with the same session ID.

**The solution:** We keep a history array (`_turns`) and inject ALL previous turns into every new prompt.

```
Task 1 prompt sent:   "Give me a development plan for a todo app"
Task 1 response:      "Here's the plan: Phase 1... Phase 2..."
→ _turns = [{ user: "Give me...", assistant: "Here's the plan..." }]

Task 2 prompt sent:
  ┌──────────────────────────────────────────────────┐
  │ [Previous conversation context]                  │
  │ Human: Give me a development plan for a todo app │
  │                                                  │
  │ Assistant: Here's the plan: Phase 1... Phase 2...│
  │                                                  │
  │ ---                                              │
  │                                                  │
  │ I'm okay with the plan. Please implement it.    │◄── current task
  └──────────────────────────────────────────────────┘

Claude now sees full context → continues the conversation ✓
```

**Code location:** `src/hooks/useTaskRunner.ts` → `buildContextPrompt()` + `_turns` array

---

## 7. Settings.local.json — Before We Spawn

Before starting `npx claude-code-acp`, we write a config file to the project directory. This is how we configure Claude Code's behavior without changing the ACP protocol.

**File written:** `{projectPath}/.claude/settings.local.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Write(*)",
      "Edit(*)",
      "Read(*)",
      "Glob(*)",
      "Grep(*)",
      "MultiEdit(*)"
    ]
  },
  "mcpServers": {
    "shadcn": {
      "type": "stdio",
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

**Why permissions.allow?** Claude Code has a hook system that blocks bash commands by default. Adding `Bash(*)` allows all commands. Without this, Claude says "shell hooks are blocking npm create."

**Why mcpServers here?** The ACP protocol v0.1.1 throws error -32600 if you pass servers in `session/new`. Claude Code reads this file on startup instead, so it works.

**Code location:** `src-tauri/src/acp/commands.rs` → `acp_initialize()` (top section)

---

## 8. The Pending Map — How Request/Response Matching Works

Since we write JSON lines to stdin and read responses from stdout asynchronously, we need to match requests to responses. We use a `pending` map:

```rust
// Type: HashMap<request_id → oneshot_sender>
let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> = ...;

// When sending a request:
let (tx, rx) = oneshot::channel();
pending.insert(request_id, tx);   // register: "when id=42 arrives, send to rx"
write_to_stdin(request);

// In the reader task (runs in parallel):
if let AcpMessage::Response { id, result } = msg {
    let tx = pending.remove(&id);  // find the waiting sender
    tx.send(Ok(result));           // wake up the command that was waiting
}

// Back in acp_send_prompt:
let result = rx.await;  // this unblocks when reader calls tx.send()
```

**Think of it like:** A ticket system. You get ticket #42, wait at the counter. When your number is called, you get your order.

---

## 9. File Map — Quick Reference

```
src-tauri/src/
├── lib.rs                    Register all Tauri commands + cleanup on window close
├── acp/
│   ├── commands.rs           5 Tauri commands: initialize, send_prompt, cancel, shutdown, is_active
│   ├── reader.rs             Background task: reads ACP stdout, routes messages, emits events
│   ├── state.rs              AcpState (shared memory) + AcpInner (process + session data)
│   └── types.rs              JSON-RPC message types + classification logic
├── agents/                   Agent config CRUD (JSON file storage)
├── tasks/                    Task history (save/list/clear per project)
└── projects/                 Project path list (add/remove/list)

src/
├── hooks/
│   ├── useTaskRunner.ts      Main hook: session management, history, streaming
│   └── useAgents.ts          Agent CRUD hook
└── components/
    └── projects/
        └── ProjectDetail.tsx  Task runner UI + agent list per project
```

---

## 10. Adding New Features — Guide for Juniors

### Add a new Rust command

**Step 1:** Write the function in `commands.rs`
```rust
#[tauri::command]
pub async fn my_new_command(
    some_param: String,
    state: State<'_, AcpState>,
) -> Result<String, String> {
    // your logic here
    Ok("result".to_string())
}
```

**Step 2:** Register it in `lib.rs`
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    acp::commands::my_new_command,  // ← add here
])
```

**Step 3:** Call it from React
```typescript
const result = await invoke<string>("my_new_command", { someParam: "hello" });
```

> **Note:** Rust uses `snake_case` parameter names. Tauri auto-converts to `camelCase` for JavaScript. `some_param` in Rust = `someParam` in TypeScript.

---

### Add a new Tauri event (Rust → React)

**Step 1:** Emit from Rust (anywhere you have `AppHandle`)
```rust
app_handle.emit("my:custom-event", serde_json::json!({ "data": "hello" }));
```

**Step 2:** Listen in React
```typescript
listen<{ data: string }>("my:custom-event", (event) => {
  console.log(event.payload.data); // "hello"
});
```

---

### Common mistakes to avoid

| Mistake | What happens | Fix |
|---------|-------------|-----|
| Forgetting `async` on Tauri command | Compile error | Add `async` to the fn signature |
| Using `State<>` param but not `async` | Compile error | Always `async` with `State<>` |
| Not registering command in `lib.rs` | `invoke()` returns "command not found" | Add to `generate_handler![]` |
| Calling `acp_send_prompt` before `acp_initialize` | Returns "ACP not initialized" error | Always check `acp_is_active` first |
| Calling `invoke()` without `await` | Response is ignored silently | Always `await invoke()` |
| Not handling the `acp:disconnected` event | UI gets stuck in "running" state | Reset `isRunning` in the listener |

---

## 11. Sequence Diagram — Full Task Execution

```
React UI          Rust Backend         claude-code-acp       Claude AI
   │                   │                      │                   │
   │── invoke ────────►│                      │                   │
   │  acp_initialize   │                      │                   │
   │                   │── spawn process ─────►                   │
   │                   │── write stdin ───────►│                  │
   │                   │  { initialize }        │                  │
   │                   │◄── stdout ────────────│                  │
   │                   │  { result: ok }        │                  │
   │                   │── write stdin ───────►│                  │
   │                   │  { session/new }       │                  │
   │                   │◄── stdout ────────────│                  │
   │                   │  { sessionId: "abc" }  │                  │
   │◄── return Ok ─────│                      │                   │
   │                   │                      │                   │
   │── invoke ────────►│                      │                   │
   │  acp_send_prompt   │── write stdin ───────►│                  │
   │  "Build todo app"  │  { session/prompt }   │── forward ──────►│
   │                   │                      │                   │
   │                   │                      │◄── stream ────────│
   │                   │◄── stdout ───────────│  "Here's step 1" │
   │                   │  { session/update }   │                   │
   │◄── event ─────────│                      │                   │
   │  acp:message-chunk │                      │◄── stream ────────│
   │  "Here's step 1"  │◄── stdout ───────────│  "Here's step 2" │
   │                   │  { session/update }   │                   │
   │◄── event ─────────│                      │                   │
   │  acp:message-chunk │                      │                   │
   │  "Here's step 2"  │                      │◄── done ──────────│
   │                   │◄── stdout ───────────│                   │
   │                   │  { Response id:42 }   │                   │
   │◄── event ─────────│                      │                   │
   │  acp:message-chunk │                      │                   │
   │  done: true       │                      │                   │
   │◄── return Ok ─────│                      │                   │
```

---

## 12. Debug Logs — The `[ACP]` Terminal Output

When you run `npm run tauri dev` and execute a task, you'll see a large JSON block in your terminal like this:

```
[ACP] Received Claude message: {
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 16790,
  "total_cost_usd": 0.40991,
  "result": "```java\npublic class Armstrong { ... }```",
  "modelUsage": {
    "claude-opus-4-6": { "inputTokens": 4, "outputTokens": 494, "costUSD": 0.364 },
    "claude-sonnet-4-20250514": { "inputTokens": 2, "outputTokens": 195, "costUSD": 0.045 }
  },
  ...
}
```

### What is this?

`claude-code-acp` prints this summary to **stderr** after every completed task. It is a diagnostic log emitted by the ACP process itself — not by our Rust code.

| Field | Meaning |
|-------|---------|
| `result` | The final text Claude returned to the user |
| `total_cost_usd` | How much this API call cost in USD |
| `modelUsage` | Which Claude models ran and their individual costs/tokens |
| `num_turns` | How many internal reasoning turns Claude took |
| `duration_ms` | Total wall-clock time for the task |
| `usage.cache_read_input_tokens` | Tokens loaded from cache (cheaper) |
| `usage.cache_creation_input_tokens` | Tokens written to cache for future reuse |

### Where does it print?

In our Rust spawn code (`src-tauri/src/acp/commands.rs`, `acp_initialize()`):

```rust
cmd.arg("claude-code-acp")
    .stderr(Stdio::inherit())   // ← this line
```

`Stdio::inherit()` means: pass the child process's stderr straight through to our parent process's stderr — the terminal where you ran `npm run tauri dev`.

**It does NOT appear in the app UI.** It is purely a developer diagnostic in your terminal. You can use the `total_cost_usd` and `modelUsage` fields to monitor API usage during development.

---

*Last updated: 2026-03-27 | Stack: Tauri v2 + React 19 + claude-code-acp@0.1.1*
