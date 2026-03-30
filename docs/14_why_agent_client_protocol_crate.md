# Why the `agent-client-protocol` Crate Is Needed

---

## 1. What the Current Approach Is

The ACP bridge in `src-tauri/src/acp/` is a **hand-rolled JSON-RPC client** written from scratch. It:

- Reads lines from the `npx claude-code-acp` subprocess stdout and parses each line as JSON (`reader.rs`)
- Classifies raw JSON-RPC messages into Response / ErrorResponse / Notification / AgentRequest (`types.rs`)
- Manages in-flight requests via a HashMap of oneshot channels (`commands.rs`)
- Sends JSON-RPC by manually serializing objects to stdin

This is a reimplementation of what the official `agent-client-protocol` Rust crate already does — but without the robustness, timeout handling, or protocol correctness that comes from a production-tested library.

---

## 2. Known Failures in the Current Implementation

### Critical Hangs

**No timeout on oneshot receivers**
`commands.rs` awaits a oneshot channel for `initialize`, `session/new`, and `session/prompt`. If the reader task crashes or panics before completing the oneshot, the command hangs forever. There is no deadline, no cancellation token, and no recovery path. The UI freezes with no error shown.

**Reader task panics are silent**
`reader.rs:90` contains `serde_json::to_string(&response).unwrap()` inside the auto-approve permission handler. If serialization fails (e.g., unexpected type), the reader task panics. The task is spawned but never monitored — the panic drops all pending oneshots and the session becomes permanently unresponsive, with no error emitted to the frontend.

**Stdin write blocking**
`send_request()` and `send_notification()` write to stdin synchronously inside an async context with no back-pressure. If the agent subprocess stops reading stdin (e.g., during a long tool call), the write blocks indefinitely.

---

### Data Loss / Silent Errors

**Malformed JSON silently skipped**
`reader.rs` has `Err(_) => continue` on JSON parse failure. Any line the agent emits that is not valid JSON is dropped silently. No error is logged, no chunk is lost to the frontend — the message simply disappears.

**MCP server configuration silently lost**
`commands.rs` writes MCP server config to `settings.local.json` before spawning the agent. If `create_dir_all` or the file write fails, the error is ignored and the agent starts without MCP servers configured. The user sees the agent running normally but MCP tools are unavailable with no explanation.

**Unclassifiable messages silently dropped**
`types.rs:classify()` returns `None` for messages that don't match the expected JSON-RPC structure. `reader.rs` has `None => continue`. Any future ACP protocol messages with new shapes are silently discarded.

---

### Race Conditions

**Double-init race**
`do_acp_init()` in `commands.rs` first acquires a read lock to check if the session key already exists, then drops the lock, then acquires a write lock to insert. Between the read and the write, another concurrent `acp_initialize_session` call with the same session key can pass the check too. Both spawn separate subprocesses. Only one gets stored; the other leaks as an orphaned process with no way to kill it.

**No session isolation for concurrent prompts**
Each session has a single `pending` HashMap and a single `next_id` counter. If two `acp_send_prompt_session` calls are made concurrently on the same session key, both write to stdin and both await from the shared pending map. Responses are matched by integer ID only — there is no guarantee the correct caller gets the correct response.

---

### Process Leaks

**No orphaned process detection on spawn failure**
If `Command::new("npx")` spawns successfully but `child.stdin.take()` or `child.stdout.take()` returns `None`, the error path drops the child handle. The process is now running with no Tauri handle, no way to kill it, and no way to detect it. It will run until the OS terminates it.

**Kill failures are ignored on shutdown**
`do_shutdown()` calls `child.kill().await` but ignores the result. If the kill fails (process already exited, permission error), the session map entry is removed but the process state is unknown.

**No process group management**
On macOS/Linux, `npx` spawns child Node.js processes. Killing the `npx` parent with `child.kill()` does not guarantee the Node.js child process is terminated. These can remain as zombie/orphaned processes consuming memory.

---

### Design Workarounds — Signs of Protocol Mismatch

**ACP 0.1.1 rejects MCP servers in `session/new`**
The official ACP protocol sends MCP server configuration in the `session/new` request. But the current `npx claude-code-acp` (ACP 0.1.1) returns error `-32600` (invalid request) if `mcpServers` is non-empty. The workaround writes MCP configuration to `.claude/settings.local.json` on disk before spawning the subprocess.

This settings file is not transactional. If multiple pipeline agents initialize simultaneously, they all write to the same file concurrently. The last write wins — some agents may start with another agent's MCP server configuration, or with a partial/corrupt JSON file.

**Dual field naming handled ad-hoc**
The current Node.js ACP bridge uses `sessionUpdate: "agent_message_chunk"` in some versions and `type: "AgentMessageChunk"` in others. `extract_chunk_text()` in `reader.rs` handles both with a runtime check. This is not documented in the protocol spec and requires manual tracking as the protocol evolves.

**Hardcoded preload script path**
`commands.rs` sets `NODE_OPTIONS=--require .../acp-preload.cjs` via a path relative to the Cargo manifest directory. If this file is missing or the relative path breaks (e.g., in a production build), the agent spawns without the preload silently. No error is returned.

---

### Known Broken Feature — Issue #225

**Model selection is broken**

`do_acp_init()` passes `ANTHROPIC_MODEL` as an environment variable to the subprocess:

```rust
.env("ANTHROPIC_MODEL", model)
```

This is the mechanism intended to let each agent use its configured model (Claude Opus, Haiku, etc.). However, `npx claude-code-acp` does not read `ANTHROPIC_MODEL` from the environment. The model selection is silently ignored. Every agent always runs on the default model (Sonnet) regardless of what is configured in the UI.

This is a known issue in the `npx claude-code-acp` Node.js bridge. It **cannot be fixed** by modifying this app's Rust code — the only path to working model selection is switching to the native Rust ACP client (`agent-client-protocol` crate), which accepts the model parameter directly in the protocol.

---

### Security

**All permissions auto-approved unconditionally**
`reader.rs:74-83` responds to every `session/request_permission` agent request with `"outcome": "allow_always"` regardless of what is being requested. Bash execution, file writes, network access, and arbitrary tool calls are all approved without distinguishing between them, without scope checks, and without notifying the user. This circumvents Layer 2 of Claude Code's permission system entirely.

---

### Frontend Visibility Problems

**Disconnect event carries no reason**
`AcpDisconnectedEvent` only contains `session_key`. The frontend cannot tell whether the session ended normally, crashed, or was killed. All three show the same behavior in the UI.

**No done chunk on error path**
`do_send_prompt()` emits a final done chunk only after `session/prompt` succeeds. If the prompt returns an error, the error is returned to the Tauri command but the done chunk is still emitted, potentially confusing the frontend into thinking a successful response was received.

**No sequence numbers on chunks**
Streaming chunks carry no index. If the agent emits chunks with reordering (e.g., due to buffering), the frontend has no way to detect or correct the order. Text accumulation in the UI may show scrambled output.

---

## 3. Summary — Current Failure Count

| Category | Count |
|----------|-------|
| Critical hangs (no timeout, blocking write, silent panic) | 3 |
| Data loss / silent errors | 3 |
| Race conditions | 2 |
| Process leaks | 3 |
| Design workarounds from protocol mismatch | 4 |
| Known broken feature (model selection, Issue #225) | 1 |
| Security (unconditional permission grant) | 1 |
| Frontend visibility / state desync | 3 |
| **Total** | **20** |

---

## 4. What the `agent-client-protocol` Crate Provides

The official Rust crate (`agent-client-protocol`, v0.10.3) is the reference ACP client used in production by the Zed editor.

**`Client` trait** — implement two typed callbacks:
- `request_permission(req: PermissionRequest) → PermissionResponse` — called when the agent requests a tool permission
- `session_notification(notification: SessionNotification)` — called for each streaming chunk and session event

**`ClientSideConnection`** — manages the full protocol lifecycle:
- Owns the stdin/stdout pipes
- Spawns and manages the background reader internally
- Correlates JSON-RPC requests to responses with proper timeout handling
- Exposes typed methods: `initialize()`, `new_session()`, `prompt()`, `cancel()`
- Handles both `sessionUpdate` and `type` field naming transparently

The crate eliminates all 20 failure points above because:
- Protocol handling is battle-tested from Zed production usage
- Timeouts and error propagation are built into the typed methods
- Background reader lifecycle is managed internally — no orphaned tasks
- Request-response correlation uses proper internal locking, not a shared HashMap
- Model selection is passed via the typed API, not an env var workaround

---

## 5. What Changes vs What Stays

### Removed — replaced by the crate

| Current File | What It Does | Replaced By |
|---|---|---|
| `acp/reader.rs` | Background stdout reader + dispatcher | `ClientSideConnection` internals |
| `acp/types.rs` (JSON-RPC types) | `JsonRpcIncoming`, `AcpMessage`, `classify()` | Crate's typed message system |
| `send_request()` in `commands.rs` | Manual JSON-RPC write + oneshot | Crate's typed methods |
| `send_notification()` in `commands.rs` | Manual notification write | Crate's methods |
| Handshake code in `commands.rs` | `initialize` + `session/new` JSON | `connection.initialize()` + `connection.new_session()` |

### Kept — unchanged

| What | Why |
|---|---|
| `acp/state.rs` — `AcpState` HashMap | Multi-session management stays ours |
| Process spawning (`Command::new("npx")`) | Crate handles protocol, not subprocess |
| `settings.local.json` write | MCP workaround still needed until ACP 0.2+ |
| All Tauri command signatures | Frontend (`useTaskRunner`, `usePipelineRunner`) unchanged |
| Tauri event emission (`acp:message-chunk`, `acp:disconnected`) | Frontend listeners unchanged |

---

## 6. Why the Crate, Why Now

1. **Issue #225 is a blocker.** Model selection is completely broken in the current approach and cannot be fixed in this app's code. The crate's typed API passes the model through the protocol directly.

2. **The current code is a reimplementation of the crate** — written without the robustness, testing, or protocol correctness guarantees of the official library. Every protocol version update requires manual changes to `reader.rs` and `types.rs`.

3. **The crate is production-stable.** v0.10.3 is used by Zed. The earlier concern about stability no longer applies.

4. **20 failure points exist in the current implementation.** Many of these are silent — the app appears to work while data is being lost, processes are leaking, or sessions are hanging. These failures compound as more pipeline agents run concurrently.

5. **Future features require it.** The Orchestrator pattern (ReAct loop) requires reliable multi-session management with proper error handling. Building on the current fragile base would make that implementation brittle.
