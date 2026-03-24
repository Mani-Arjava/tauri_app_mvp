# How to Connect Rust to Claude via ACP

## A Standalone Guide

---

## Table of Contents

1. [What is ACP?](#1-what-is-acp)
2. [How ACP Works](#2-how-acp-works)
3. [The Protocol in Detail](#3-the-protocol-in-detail)
4. [Rust Library Options](#4-rust-library-options)
5. [Approach A: Hand-Rolled JSON-RPC (Recommended for MVPs)](#5-approach-a-hand-rolled-json-rpc)
6. [Approach B: Official `agent-client-protocol` Crate](#6-approach-b-official-agent-client-protocol-crate)
7. [Spawning Claude Code as an ACP Agent](#7-spawning-claude-code-as-an-acp-agent)
8. [Handling Streaming Responses](#8-handling-streaming-responses)
9. [Integrating with Tauri (Rust ↔ React)](#9-integrating-with-tauri-rust--react)
10. [Real-World Example: Sidecar Pattern](#10-real-world-example-sidecar-pattern)
11. [Common Pitfalls](#11-common-pitfalls)
12. [Official Reference Links](#12-official-reference-links)

---

## 1. What is ACP?

The **Agent Client Protocol (ACP)** is an open standard (Apache 2.0) created by **Zed Industries** and **Block** that standardizes communication between code editors/apps ("Clients") and AI coding agents ("Agents") — like how **LSP** standardizes editor ↔ language server communication.

**The key insight:** ACP decouples AI agents from specific editors. Any ACP-compatible client (Zed, JetBrains, your Tauri app) can talk to any ACP-compatible agent (Claude Code, Codex CLI, Gemini CLI, Goose) using the same protocol.

```
Your Rust App ──┐                    ┌── Claude Code
Zed Editor    ──┤── ACP (JSON-RPC) ──├── Codex CLI
JetBrains     ──┘                    └── Gemini CLI
```

**ACP is NOT the same as MCP:**
- **ACP** = connects an **app/editor** to an **AI agent** (where it works)
- **MCP** = connects an **AI agent** to **external tools/data** (what it accesses)

They're complementary. Your Rust app uses ACP to talk to Claude Code, and Claude Code uses MCP to access external tools.

> **Official spec:** https://agentclientprotocol.com

---

## 2. How ACP Works

### Transport: stdio (stdin/stdout)

ACP's primary transport is **stdio** — the client spawns the agent as a **subprocess** and communicates over piped stdin/stdout:

```
┌─────────────────┐         stdin (client → agent)         ┌──────────────────┐
│                 │  ─────────────────────────────────────> │                  │
│  Your Rust App  │                                         │  Claude Code CLI │
│  (ACP Client)   │  <───────────────────────────────────── │  (ACP Agent)     │
│                 │         stdout (agent → client)         │                  │
└─────────────────┘                                         └──────────────────┘
                                                              stderr → logs
```

### Message Format: JSON-RPC 2.0

Every message is a **single line of JSON** (newline-delimited, no embedded newlines), following the JSON-RPC 2.0 spec:

**Requests** (expect a response):
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

**Responses** (matched by `id`):
```json
{"jsonrpc":"2.0","id":1,"result":{...}}
```

**Notifications** (no response expected, no `id` field):
```json
{"jsonrpc":"2.0","method":"session/update","params":{...}}
```

**Errors**:
```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid Request"}}
```

### Encoding Rules

- All messages **MUST** be UTF-8 encoded
- Messages are delimited by `\n` (newline)
- Messages **MUST NOT** contain embedded newlines
- Only valid ACP messages may be written to stdout
- Agents may write logs to stderr (clients handle at discretion)

---

## 3. The Protocol in Detail

### 3.1 Lifecycle

```
1. Client spawns agent subprocess
2. Client sends `initialize` request     → Agent responds with capabilities
3. Client sends `session/new` request    → Agent responds with sessionId
4. Client sends `session/prompt` request → Agent streams `session/update` notifications
                                          → Agent returns PromptResponse
5. Repeat step 4 for each user message
6. Client closes stdin → Agent exits
```

### 3.2 Initialization

The client sends its capabilities and info. The agent responds with its own.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {},
    "clientInfo": {
      "name": "my-app",
      "title": "My Application",
      "version": "1.0.0"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": false,
      "promptCapabilities": {
        "image": false,
        "audio": false,
        "embeddedContext": false
      }
    },
    "agentInfo": {
      "name": "claude-code",
      "title": "Claude Code",
      "version": "1.0.0"
    },
    "authMethods": []
  }
}
```

**Client capabilities you can declare:**

| Capability | What it enables |
|-----------|----------------|
| `fs.readTextFile` | Agent can ask you to read files |
| `fs.writeTextFile` | Agent can ask you to write files |
| `terminal` | Agent can ask you to create/manage terminals |

For a basic chat, pass an empty `clientCapabilities: {}` — the agent won't request file or terminal access.

**Agent capabilities you'll receive:**

| Capability | Meaning |
|-----------|---------|
| `loadSession` | Agent supports resuming previous sessions |
| `promptCapabilities.image` | Agent accepts image content blocks |
| `promptCapabilities.audio` | Agent accepts audio content blocks |
| `promptCapabilities.embeddedContext` | Agent accepts embedded resource content |

### 3.3 Session Creation

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/new",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "abc-123-def"
  }
}
```

### 3.4 Sending a Prompt

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/prompt",
  "params": {
    "sessionId": "abc-123-def",
    "prompt": [
      {
        "type": "text",
        "text": "What is the meaning of life?"
      }
    ]
  }
}
```

The `prompt` field is an array of `ContentBlock` objects. The simplest content block is text:

```json
{ "type": "text", "text": "your message here" }
```

### 3.5 Streaming Updates (Notifications)

After you send a prompt, the agent sends back **`session/update` notifications** — one per line on stdout. These are notifications (no `id`), so you don't respond to them.

**Text chunk (streaming response):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "abc-123-def",
    "update": {
      "type": "AgentMessageChunk",
      "content": {
        "type": "text",
        "text": "The meaning "
      }
    }
  }
}
```

Multiple chunks arrive to form the complete response.

**Tool call (agent wants to use a tool):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "abc-123-def",
    "update": {
      "type": "ToolCall",
      "toolCallId": "tc_001",
      "title": "Read file",
      "kind": "read",
      "status": "in_progress"
    }
  }
}
```

**All `SessionUpdate` types:**

| Type | Purpose |
|------|---------|
| `AgentMessageChunk` | Streamed text response (most common) |
| `AgentThoughtChunk` | Agent's reasoning/thinking |
| `UserMessageChunk` | Echo of user message |
| `ToolCall` | New tool invocation |
| `ToolCallUpdate` | Tool status/result update |
| `Plan` | Agent's execution plan |
| `AvailableCommandsUpdate` | Available commands changed |
| `CurrentModeUpdate` | Session mode changed |
| `ConfigOptionUpdate` | Configuration updated |
| `SessionInfoUpdate` | Session metadata updated |

### 3.6 Prompt Response

After all streaming updates, the agent responds to the original `session/prompt` request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "stopReason": "end_turn"
  }
}
```

**Stop reasons:**

| Reason | Meaning |
|--------|---------|
| `end_turn` | Agent finished responding normally |
| `max_tokens` | Hit token limit |
| `max_turn_requests` | Hit request limit |
| `refusal` | Agent declined to continue |
| `cancelled` | Client cancelled via `session/cancel` |

### 3.7 Cancellation

Send a **notification** (no `id`, no response expected):

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "abc-123-def"
  }
}
```

### 3.8 Permission Requests

The agent may call back to ask for permission:

```json
{
  "jsonrpc": "2.0",
  "id": 100,
  "method": "session/request_permission",
  "params": {
    "sessionId": "abc-123-def",
    "title": "Write file",
    "description": "Write to /path/to/file.txt",
    "permissions": [...]
  }
}
```

Your client must respond with the user's decision:

```json
{
  "jsonrpc": "2.0",
  "id": 100,
  "result": {
    "outcome": "allow_once"
  }
}
```

Outcome options: `allow_once`, `allow_always`, `reject_once`, `reject_always`.

---

## 4. Rust Library Options

### Option A: Hand-Rolled JSON-RPC (Recommended for MVPs)

Write the JSON-RPC messages yourself using `serde_json`. This is simple, has zero ACP-specific dependencies, and gives you full control.

```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["process", "io-util"] }
```

**Pros:** Minimal deps, easy to debug, no version coupling to ACP spec
**Cons:** Must define types manually, no compile-time protocol guarantees

### Option B: Official `agent-client-protocol` Crate

The official Rust SDK provides type-safe `Agent` and `Client` traits with all message types pre-defined.

```toml
[dependencies]
agent-client-protocol = "0.10"
```

**Pros:** Type-safe, complete API surface, maintained by ACP team
**Cons:** Pulls in many transitive deps, uses `!Send` futures (requires `tokio::task::LocalSet`), more complex setup

### Option C: Schema Types Only

Use just the type definitions without the connection management:

```toml
[dependencies]
agent-client-protocol-schema = "0.11"
```

**Pros:** All ACP types with serde support, lighter than full SDK
**Cons:** Must handle connection/IO yourself

### Recommendation

For a Tauri app MVP, **Option A** (hand-rolled) is simplest. If the ACP integration grows complex, migrate to **Option B** or **Option C**.

---

## 5. Approach A: Hand-Rolled JSON-RPC

### Step 1: Spawn the Agent

```rust
use std::process::{Command, Stdio};
use tokio::process::Command as TokioCommand;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn spawn_claude() -> Result<tokio::process::Child, Box<dyn std::error::Error>> {
    let child = TokioCommand::new("claude")
        .arg("--acp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    Ok(child)
}
```

### Step 2: Send a JSON-RPC Request

```rust
use serde_json::json;
use tokio::io::AsyncWriteExt;

async fn send_request(
    stdin: &mut tokio::process::ChildStdin,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let request = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });

    let mut line = serde_json::to_string(&request)?;
    line.push('\n');
    stdin.write_all(line.as_bytes()).await?;
    stdin.flush().await?;

    Ok(())
}
```

### Step 3: Read Responses and Notifications

```rust
use tokio::io::{AsyncBufReadExt, BufReader};

async fn read_messages(
    stdout: tokio::process::ChildStdout,
) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        // Parse as JSON-RPC
        let msg: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Invalid JSON from agent: {}", e);
                continue;
            }
        };

        if msg.get("id").is_some() && msg.get("method").is_none() {
            // This is a Response (has id, no method)
            let id = msg["id"].as_u64().unwrap_or(0);
            println!("Response for request {}: {:?}", id, msg["result"]);

            if let Some(error) = msg.get("error") {
                eprintln!("Error: {}", error);
            }
        } else if msg.get("method").is_some() && msg.get("id").is_some() {
            // This is a Request FROM the agent (e.g., request_permission)
            let method = msg["method"].as_str().unwrap_or("");
            println!("Agent request: {}", method);
            // Handle permission requests, etc.
        } else if msg.get("method").is_some() {
            // This is a Notification (has method, no id)
            let method = msg["method"].as_str().unwrap_or("");
            if method == "session/update" {
                handle_session_update(&msg["params"]);
            }
        }
    }
}

fn handle_session_update(params: &serde_json::Value) {
    let update_type = params["update"]["type"].as_str().unwrap_or("");

    match update_type {
        "AgentMessageChunk" => {
            let text = params["update"]["content"]["text"].as_str().unwrap_or("");
            print!("{}", text); // Stream to console (or emit to UI)
        }
        "ToolCall" => {
            let title = params["update"]["title"].as_str().unwrap_or("");
            println!("\n[Tool: {}]", title);
        }
        "ToolCallUpdate" => {
            let status = params["update"]["status"].as_str().unwrap_or("");
            println!("[Tool status: {}]", status);
        }
        _ => {
            // Plan, mode changes, etc. — ignore or log
        }
    }
}
```

### Step 4: Full Lifecycle Example

```rust
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use std::process::Stdio;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Spawn Claude Code
    let mut child = Command::new("claude")
        .arg("--acp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    let mut stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let mut reader = BufReader::new(stdout).lines();

    // Helper to send and read response
    let mut next_id: u64 = 1;
    let mut send = |stdin: &mut tokio::process::ChildStdin, method: &str, params: serde_json::Value| {
        let id = next_id;
        next_id += 1;
        let req = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        async move {
            let mut line = serde_json::to_string(&req)? + "\n";
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
            Ok::<u64, Box<dyn std::error::Error>>(id)
        }
    };

    // 2. Initialize
    send_request(&mut stdin, 1, "initialize", json!({
        "protocolVersion": 1,
        "clientCapabilities": {},
        "clientInfo": { "name": "my-app", "version": "1.0" }
    })).await?;

    // Read initialize response
    if let Ok(Some(line)) = reader.next_line().await {
        let resp: serde_json::Value = serde_json::from_str(&line)?;
        println!("Initialized: {:?}", resp["result"]["agentInfo"]);
    }

    // 3. Create session
    send_request(&mut stdin, 2, "session/new", json!({})).await?;

    let session_id = if let Ok(Some(line)) = reader.next_line().await {
        let resp: serde_json::Value = serde_json::from_str(&line)?;
        resp["result"]["sessionId"].as_str().unwrap_or("").to_string()
    } else {
        return Err("No session response".into());
    };

    println!("Session: {}", session_id);

    // 4. Send a prompt
    send_request(&mut stdin, 3, "session/prompt", json!({
        "sessionId": session_id,
        "prompt": [{ "type": "text", "text": "Hello Claude! What is 2 + 2?" }]
    })).await?;

    // 5. Read streaming updates until we get the prompt response
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                let msg: serde_json::Value = serde_json::from_str(&line)?;

                if msg.get("method") == Some(&json!("session/update")) {
                    // Streaming notification
                    let update_type = msg["params"]["update"]["type"].as_str().unwrap_or("");
                    if update_type == "AgentMessageChunk" {
                        let text = msg["params"]["update"]["content"]["text"]
                            .as_str().unwrap_or("");
                        print!("{}", text);
                    }
                } else if msg.get("id") == Some(&json!(3)) {
                    // Response to our prompt request
                    let stop = msg["result"]["stopReason"].as_str().unwrap_or("unknown");
                    println!("\n\n[Done: {}]", stop);
                    break;
                }
            }
            Ok(None) => break, // stdout closed
            Err(e) => { eprintln!("Read error: {}", e); break; }
        }
    }

    // 6. Shutdown — close stdin, agent exits
    drop(stdin);
    child.wait().await?;

    Ok(())
}

async fn send_request(
    stdin: &mut tokio::process::ChildStdin,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let request = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let line = serde_json::to_string(&request)? + "\n";
    stdin.write_all(line.as_bytes()).await?;
    stdin.flush().await?;
    Ok(())
}
```

---

## 6. Approach B: Official `agent-client-protocol` Crate

### Setup

```toml
[dependencies]
agent-client-protocol = "0.10"
agent-client-protocol-schema = "0.11"
tokio = { version = "1", features = ["full"] }
futures = "0.3"
anyhow = "1"
```

### Implementing the Client Trait

Your app implements the `Client` trait — the agent calls these methods back on you:

```rust
use agent_client_protocol as acp;
use agent_client_protocol_schema::*;
use std::pin::Pin;
use std::future::Future;
use anyhow::Result;

struct MyClient {
    // Your state: UI handles, message channels, etc.
}

impl acp::Client for MyClient {
    fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<RequestPermissionResponse>>>> {
        Box::pin(async move {
            // Show a permission dialog to the user
            // For now, auto-approve everything
            Ok(RequestPermissionResponse {
                outcome: RequestPermissionOutcome::AllowOnce,
                meta: None,
            })
        })
    }

    fn session_notification(
        &self,
        args: SessionNotification,
    ) -> Pin<Box<dyn Future<Output = Result<()>>>> {
        Box::pin(async move {
            match &args.update {
                SessionUpdate::AgentMessageChunk(chunk) => {
                    // Display streamed text in your UI
                    if let ContentBlock::Text(text) = &chunk.content {
                        print!("{}", text.text);
                    }
                }
                SessionUpdate::ToolCall(tc) => {
                    println!("\n[Tool: {}]", tc.title);
                }
                _ => {}
            }
            Ok(())
        })
    }
}
```

### Creating the Connection

```rust
use agent_client_protocol as acp;
use tokio::process::Command;
use futures::io::AsyncReadExt;

async fn connect_to_claude() -> Result<impl acp::Agent> {
    let local_set = tokio::task::LocalSet::new();

    local_set.run_until(async {
        // Spawn Claude Code
        let mut child = Command::new("claude")
            .arg("--acp")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()?;

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        // Convert to futures-compatible streams
        let outgoing = tokio_util::compat::TokioAsyncWriteCompatExt::compat_write(stdin);
        let incoming = tokio_util::compat::TokioAsyncReadCompatExt::compat(stdout);

        // Create ACP connection — returns (connection, io_future)
        let (connection, io_fut) = acp::ClientSideConnection::new(
            MyClient { },
            outgoing,
            incoming,
            |fut| { tokio::task::spawn_local(fut); },
        );

        // Spawn the I/O handler
        tokio::task::spawn_local(io_fut);

        // Now `connection` implements the Agent trait:
        let init_resp = connection.initialize(InitializeRequest::new(
            ProtocolVersion::latest(),
        )).await?;

        let session = connection.new_session(NewSessionRequest::new()).await?;

        let prompt_resp = connection.prompt(PromptRequest::new(
            session.session_id,
            vec![ContentBlock::Text(TextContent::new("Hello Claude!"))],
        )).await?;

        println!("Stop reason: {:?}", prompt_resp.stop_reason);

        Ok(connection)
    }).await
}
```

### Important: `!Send` Futures

The SDK's connection types use `!Send` futures (due to the `spawn` closure pattern). You **must** use `tokio::task::LocalSet` to run them:

```rust
#[tokio::main]
async fn main() {
    let local_set = tokio::task::LocalSet::new();
    local_set.run_until(async {
        // All ACP operations go here
    }).await;
}
```

This is a key architectural constraint — it means ACP operations can't be freely moved between tokio worker threads.

---

## 7. Spawning Claude Code as an ACP Agent

### Prerequisites

1. **Install Claude Code CLI:**
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Authenticate** (run once):
   ```bash
   claude
   # Complete the OAuth login flow in your browser
   ```

3. **Verify ACP mode works:**
   ```bash
   echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | claude --acp
   ```

### The `--acp` Flag

Claude Code supports ACP via the `--acp` command-line flag, which puts it in ACP agent mode — reading JSON-RPC from stdin and writing responses to stdout.

### Finding the Binary

```rust
use std::process::Command;

fn find_claude_binary() -> Result<String, String> {
    // Try the command directly (relies on PATH)
    if Command::new("claude").arg("--version").output().is_ok() {
        return Ok("claude".to_string());
    }

    // Try common locations on macOS
    let paths = [
        "/usr/local/bin/claude",
        &format!("{}/.npm-global/bin/claude", std::env::var("HOME").unwrap_or_default()),
    ];

    for path in &paths {
        if std::path::Path::new(path).exists() {
            return Ok(path.to_string());
        }
    }

    Err("Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code".into())
}
```

### Authentication

Claude Code manages its own authentication. On macOS, it stores OAuth tokens in the Keychain:

```
security find-generic-password -s "Claude Code-credentials" -w
```

Your Rust app doesn't need to handle auth — Claude Code does it internally when spawned. If the user isn't authenticated, the `initialize` call will fail (or Claude Code won't start), and you should show a helpful error message.

---

## 8. Handling Streaming Responses

### The Challenge

When you send `session/prompt`, the agent sends back a mix of:
1. **Notifications** (`session/update`) — streaming text, tool calls, etc.
2. **The response** — the final `PromptResponse` with `stopReason`
3. **Possible requests** — like `session/request_permission`

All of these arrive on the same stdout pipe, interleaved. Your reader must dispatch correctly.

### Pattern: Dedicated Reader Thread

Spawn a dedicated thread/task to continuously read stdout and dispatch messages:

```rust
use tokio::sync::mpsc;

enum AcpMessage {
    Response { id: u64, result: serde_json::Value },
    Notification { method: String, params: serde_json::Value },
    Request { id: u64, method: String, params: serde_json::Value },
    Error { id: u64, error: serde_json::Value },
}

async fn spawn_reader(
    stdout: tokio::process::ChildStdout,
    tx: mpsc::UnboundedSender<AcpMessage>,
) {
    let reader = tokio::io::BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let msg: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let has_id = msg.get("id").and_then(|v| v.as_u64());
        let has_method = msg.get("method").and_then(|v| v.as_str()).map(String::from);
        let has_error = msg.get("error").is_some();

        let acp_msg = match (has_id, has_method, has_error) {
            (Some(id), None, false) => AcpMessage::Response {
                id,
                result: msg["result"].clone(),
            },
            (Some(id), None, true) => AcpMessage::Error {
                id,
                error: msg["error"].clone(),
            },
            (Some(id), Some(method), _) => AcpMessage::Request {
                id,
                method,
                params: msg["params"].clone(),
            },
            (None, Some(method), _) => AcpMessage::Notification {
                method,
                params: msg["params"].clone(),
            },
            _ => continue,
        };

        if tx.send(acp_msg).is_err() {
            break; // Receiver dropped
        }
    }
}
```

### Pattern: Dual-Dispatch (Events + Responses)

For Tauri apps, you want to both:
1. **Fire events** to the frontend (for real-time streaming)
2. **Match responses** to waiting requests (for async/await)

```rust
use std::collections::HashMap;
use tokio::sync::oneshot;

struct PendingRequests {
    requests: HashMap<u64, oneshot::Sender<serde_json::Value>>,
}

// In your reader loop:
match acp_msg {
    AcpMessage::Response { id, result } => {
        // Complete the waiting request
        if let Some(tx) = pending.requests.remove(&id) {
            let _ = tx.send(result);
        }
    }
    AcpMessage::Notification { method, params } if method == "session/update" => {
        // Fire Tauri event to frontend
        app_handle.emit("acp:session-update", &params).ok();
    }
    AcpMessage::Request { id, method, params } => {
        // Handle agent requests (e.g., permission)
        // Send response back via stdin
    }
    _ => {}
}
```

---

## 9. Integrating with Tauri (Rust ↔ React)

### Tauri IPC Overview

Tauri provides two IPC mechanisms:

| Mechanism | Direction | Use Case |
|-----------|-----------|----------|
| **Commands** (`invoke`) | Frontend → Rust | User actions: send prompt, cancel, initialize |
| **Events** (`emit`/`listen`) | Rust → Frontend | Streaming: message chunks, tool calls, errors |

### Rust Side: Tauri Commands

```rust
use tauri::{AppHandle, Emitter, State};
use std::sync::Mutex;

struct AppState {
    acp: Mutex<Option<AcpClient>>,
}

#[tauri::command]
async fn acp_send_prompt(
    message: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let guard = state.acp.lock().map_err(|e| e.to_string())?;
    let client = guard.as_ref().ok_or("Not connected")?;

    // This triggers the agent, which sends session/update notifications
    // The reader thread picks them up and emits Tauri events
    client.prompt(&message).await.map_err(|e| e.to_string())?;

    Ok("sent".into())
}
```

### Rust Side: Emitting Events

```rust
// In your stdout reader thread:
if update_type == "AgentMessageChunk" {
    let text = params["update"]["content"]["text"].as_str().unwrap_or("");
    app_handle.emit("acp:message-chunk", serde_json::json!({
        "text": text,
        "done": false,
    })).ok();
}
```

### TypeScript Side: Listening for Events

```typescript
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// Send a prompt
await invoke('acp_send_prompt', { message: "Hello Claude" });

// Listen for streaming chunks
const unlisten = await listen<{ text: string; done: boolean }>('acp:message-chunk', (event) => {
  const { text, done } = event.payload;
  // Append text to your chat UI
  appendToCurrentMessage(text);
  if (done) {
    finalizeMessage();
  }
});

// Cleanup
unlisten();
```

### React Hook Pattern

```typescript
import { useEffect, useCallback, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export function useAcpChat() {
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const unlisten = listen<{ text: string; done: boolean }>('acp:message-chunk', (event) => {
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && !event.payload.done) {
          updated[lastIdx] += event.payload.text;
        }
        return updated;
      });
    });

    return () => { unlisten.then(fn => fn()); };
  }, []);

  const send = useCallback(async (text: string) => {
    setMessages(prev => [...prev, text, '']); // Add user msg + empty assistant msg
    await invoke('acp_send_prompt', { message: text });
  }, []);

  return { messages, send };
}
```

---

## 10. Real-World Example: Sidecar Pattern

The **Solo IDE** project (https://www.sachinadlakha.us/blog/desktop-ai-ide-claude-sdk) demonstrates a production Tauri v2 app connecting to Claude. Key architectural insights:

### Architecture: Node.js Sidecar

Instead of using ACP directly, Solo IDE spawns a **Node.js sidecar process** that runs the Claude Agent SDK:

```
Tauri App (Rust) → stdin/stdout (NDJSON) → Node.js Sidecar → Claude Agent SDK → Claude API
```

This is an alternative to ACP — it wraps the Agent SDK in a subprocess rather than using Claude Code CLI.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Node.js sidecar** over native Rust | Claude Agent SDK is Node.js-only; re-implementing in Rust would be prohibitively complex |
| **Newline-delimited JSON** protocol | Trivially parseable, debuggable (`| jq`), handles mixed message types |
| **Bounded channels (capacity 1000)** | Prevents memory exhaustion when frontend can't keep up with output speed |
| **Separate reader thread** | Avoids stdin/stdout deadlock — stdin writes could block while stdout buffer fills |
| **Ready handshake** | App blocks on startup until sidecar sends `ready` event, preventing premature requests |
| **No permission timeout** | `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=86400000` (24h) to accommodate user think time |

### ACP vs Sidecar Comparison

| | ACP (claude --acp) | Sidecar (Node.js + Agent SDK) |
|---|-------------------|-------------------------------|
| **Setup complexity** | Lower — just spawn `claude --acp` | Higher — need Node.js runtime + script |
| **Protocol** | Standardized JSON-RPC | Custom NDJSON messages |
| **Capabilities** | Full ACP feature set | Full Agent SDK feature set |
| **Auth** | Claude Code handles it | Must extract OAuth token from Keychain |
| **Dependencies** | Claude Code CLI only | Node.js + Claude Agent SDK package |
| **Portability** | Works with any ACP agent | Claude-specific |

**Recommendation:** Use ACP if you want standard agent interop. Use the sidecar pattern if you need deep Agent SDK features (hooks, subagents, custom tools) that ACP doesn't expose.

---

## 11. Common Pitfalls

### 1. Deadlock on stdin/stdout

**Problem:** If you write to stdin on the main thread while reading stdout on the same thread, the process can deadlock — the agent's stdout buffer fills up while you're blocked writing to stdin.

**Solution:** Always use separate threads/tasks for reading and writing:

```rust
// Good: separate reader task
let reader_handle = tokio::spawn(async move {
    read_messages(stdout).await;
});

// Write from a different task
stdin.write_all(b"...\n").await?;
```

### 2. Embedded Newlines in Messages

**Problem:** JSON strings can contain `\n` characters. If you naively split on newlines, you'll corrupt messages.

**Solution:** ACP messages are **serialized as single lines** — the `serde_json::to_string()` function never produces literal newlines (they become `\n` escape sequences in JSON). So line-based reading is safe. Just don't use `to_string_pretty()`.

### 3. Mixed Message Types on stdout

**Problem:** Responses, notifications, and agent requests all arrive on the same stdout pipe. If you only handle responses, you'll miss streaming updates.

**Solution:** Dispatch by checking `id` and `method` fields (see Section 5, Step 3).

### 4. `!Send` Futures with Official Crate

**Problem:** The `agent-client-protocol` crate's futures are `!Send`, which means they can't cross thread boundaries. Tokio's default multi-threaded runtime requires `Send` futures.

**Solution:** Use `tokio::task::LocalSet`:
```rust
let local_set = tokio::task::LocalSet::new();
local_set.run_until(async { /* ACP operations here */ }).await;
```

### 5. Agent Not Found

**Problem:** `Command::new("claude")` fails because the binary isn't in PATH.

**Solution:** Check common install locations, or let the user configure the path:
```rust
let claude_path = std::env::var("CLAUDE_PATH")
    .unwrap_or_else(|_| "claude".to_string());
```

### 6. Process Cleanup

**Problem:** If your app crashes or the user force-quits, the Claude Code subprocess may be left running.

**Solution:** Drop the `Child` handle (which closes stdin), and implement a `Drop` guard:
```rust
impl Drop for AcpConnection {
    fn drop(&mut self) {
        // Close stdin to signal the agent to exit
        drop(self.stdin.take());
        // Optionally kill the process
        let _ = self.child.kill();
    }
}
```

---

## 12. Official Reference Links

### ACP Protocol

| Resource | URL |
|----------|-----|
| **ACP Official Site** | https://agentclientprotocol.com |
| **Protocol Overview** | https://agentclientprotocol.com/protocol/overview |
| **Initialization Spec** | https://agentclientprotocol.com/protocol/initialization |
| **Prompt Turn Spec** | https://agentclientprotocol.com/protocol/prompt-turn |
| **Transport Spec** | https://agentclientprotocol.com/protocol/transports |
| **ACP GitHub (spec repo)** | https://github.com/agentclientprotocol/agent-client-protocol |

### Rust Libraries

| Resource | URL |
|----------|-----|
| **`agent-client-protocol` crate** | https://crates.io/crates/agent-client-protocol |
| **Rust SDK API docs** | https://docs.rs/agent-client-protocol |
| **`agent-client-protocol-schema` crate** | https://crates.io/crates/agent-client-protocol-schema |
| **Schema API docs** | https://docs.rs/agent-client-protocol-schema |
| **Rust SDK GitHub** | https://github.com/agentclientprotocol/rust-sdk |
| **Rust SDK examples** | https://github.com/agentclientprotocol/rust-sdk/tree/main/examples |
| **`acpx` crate (subprocess launcher)** | https://crates.io/crates/acpx |
| **`acpx` docs** | https://docs.rs/acpx |

### Claude Code as ACP Agent

| Resource | URL |
|----------|-----|
| **Zed ACP page** | https://zed.dev/acp |
| **Claude Code ACP adapter** | https://github.com/zed-industries/claude-agent-acp |

### Background Reading

| Resource | URL |
|----------|-----|
| **ACP intro (Goose/Block blog)** | https://block.github.io/goose/blog/2025/10/24/intro-to-agent-client-protocol-acp/ |
| **Solo IDE (Tauri + Claude example)** | https://www.sachinadlakha.us/blog/desktop-ai-ide-claude-sdk |
| **ACP agent registry** | https://agentclientprotocol.com/get-started/agents |
| **ACP client registry** | https://agentclientprotocol.com/get-started/clients |
| **JetBrains ACP docs** | https://www.jetbrains.com/help/ai-assistant/acp.html |

### Related Protocols

| Resource | URL |
|----------|-----|
| **MCP (Model Context Protocol)** | https://modelcontextprotocol.io |
| **Claude Agent SDK** | https://platform.claude.com/docs/en/agent-sdk/overview |
