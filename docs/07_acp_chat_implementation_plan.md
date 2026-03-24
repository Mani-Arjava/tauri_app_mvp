# ACP Chat Integration — Implementation Plan

## Adding an AI Chat Panel to the Employee Data Manager

---

## 1. Goal

Add a **chat panel** to the Employee Data Manager desktop app that lets users talk to **Claude** (via Claude Code) using the **Agent Client Protocol (ACP)**. The chat panel will be embedded in the existing Tauri v2 app alongside the employee management features.

### What This Enables

- Ask Claude questions about employees: "List all Engineering department employees"
- Get help with the app: "How do I add a new employee?"
- General coding assistance while using the app
- Future: Claude directly reads/writes employee data via ACP tool calls

### What This Is NOT

- Not replacing the existing employee CRUD UI
- Not using the Anthropic API directly (we go through Claude Code as an ACP agent)
- Not a full IDE integration — just a chat panel in our desktop app

---

## 2. Architecture Overview

### How the Pieces Fit Together

```
┌─────────────────────────────────────────────────────────────────┐
│                       Tauri Window                               │
│                                                                  │
│  ┌──────────┐  ┌──────────────────────┐  ┌───────────────────┐  │
│  │          │  │                      │  │                   │  │
│  │ Sidebar  │  │   Employee Views     │  │   Chat Panel      │  │
│  │ (nav)    │  │   (existing CRUD)    │  │   (new)           │  │
│  │          │  │                      │  │                   │  │
│  │          │  │                      │  │  ┌─────────────┐  │  │
│  │          │  │                      │  │  │ Messages    │  │  │
│  │          │  │                      │  │  │ (scrollable)│  │  │
│  │          │  │                      │  │  ├─────────────┤  │  │
│  │          │  │                      │  │  │ Input box   │  │  │
│  │          │  │                      │  │  └─────────────┘  │  │
│  └──────────┘  └──────────────────────┘  └───────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
        │                                          │
        │         Tauri IPC (invoke + events)       │
        │                                          │
┌───────┴──────────────────────────────────────────┴──────────────┐
│                     Rust Backend (src-tauri/)                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  ACP Client Module                        │   │
│  │                                                           │   │
│  │  - Spawns Claude Code as subprocess                       │   │
│  │  - Sends ACP JSON-RPC over stdin                          │   │
│  │  - Reads ACP responses from stdout                        │   │
│  │  - Streams session/update notifications to frontend       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                    stdin/stdout                                   │
│                    (ACP JSON-RPC)                                 │
│                          │                                       │
│                ┌─────────┴──────────┐                            │
│                │   Claude Code CLI  │                            │
│                │   (ACP Agent)      │                            │
│                └────────────────────┘                            │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow for a Chat Message

```
1. User types "Hello Claude" in chat input
2. React calls: invoke('acp_send_prompt', { message: "Hello Claude" })
3. Rust ACP client sends JSON-RPC to Claude Code's stdin:
   { "jsonrpc": "2.0", "id": 3, "method": "session/prompt",
     "params": { "sessionId": "...", "prompt": [{ "type": "text", "text": "Hello Claude" }] } }
4. Claude Code processes the prompt, sends streaming updates to stdout:
   { "jsonrpc": "2.0", "method": "session/update",
     "params": { "sessionId": "...", "update": { "type": "AgentMessageChunk", ... } } }
5. Rust reads each update line, emits Tauri event:
   app_handle.emit("acp:message-chunk", chunk_data)
6. React listener receives event, appends text to chat message in real time
7. Claude Code returns PromptResponse with stop_reason: "end_turn"
8. Rust returns the final response from the Tauri command
```

---

## 3. ACP Protocol Flow

### Lifecycle (one-time setup per app launch)

```
App starts
  │
  ├─ 1. Spawn Claude Code subprocess
  │     Command: claude --acp
  │     stdin: piped, stdout: piped, stderr: inherit
  │
  ├─ 2. Send `initialize` request
  │     Client capabilities: { fs.readTextFile: false, fs.writeTextFile: false, terminal: false }
  │     → Receive: agent capabilities, protocol version
  │
  ├─ 3. Send `session/new` request
  │     → Receive: sessionId
  │
  └─ Ready for prompts
```

### Prompt Turn (each user message)

```
User sends message
  │
  ├─ 4. Send `session/prompt` request
  │     params: { sessionId, prompt: [{ type: "text", text: "..." }] }
  │
  ├─ 5. Receive streaming `session/update` notifications
  │     - AgentMessageChunk: text deltas (stream to UI)
  │     - ToolCall: agent wants to use a tool (show in UI)
  │     - ToolCallUpdate: tool result (show in UI)
  │
  ├─ 6. Receive PromptResponse
  │     stop_reason: "end_turn" | "cancelled" | ...
  │
  └─ Ready for next prompt
```

### Cancellation

```
User clicks "Stop" button
  │
  └─ Send `session/cancel` notification
      params: { sessionId }
      (no response expected — notification, not request)
```

---

## 4. File Changes

### New Files

| File | Purpose |
|------|---------|
| `src-tauri/src/acp/mod.rs` | ACP client module — subprocess management, JSON-RPC |
| `src-tauri/src/acp/types.rs` | Rust types for ACP messages (serde-compatible) |
| `src-tauri/src/acp/connection.rs` | Subprocess spawn + stdin/stdout I/O |
| `src-tauri/src/acp/commands.rs` | Tauri IPC commands (`acp_initialize`, `acp_send_prompt`, etc.) |
| `src/types/chat.ts` | TypeScript types for chat messages |
| `src/hooks/useChat.ts` | Chat state management hook |
| `src/components/ChatPanel.tsx` | Chat UI component |
| `src/components/ChatMessage.tsx` | Individual message bubble |
| `src/styles/chat.css` | Chat panel styles |

### Modified Files

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Register ACP Tauri commands |
| `src-tauri/Cargo.toml` | Add `serde_json`, `tokio` dependencies |
| `src/App.tsx` | Add ChatPanel to layout |
| `src/App.css` | Adjust layout for chat panel |
| `src/types/employee.ts` | Add `'chat'` to AppView (optional) |

---

## 5. Rust Implementation Details

### 5.1 ACP Types (`src-tauri/src/acp/types.rs`)

```rust
use serde::{Deserialize, Serialize};

// === JSON-RPC Base ===

#[derive(Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,  // always "2.0"
    pub id: u64,
    pub method: String,
    pub params: serde_json::Value,
}

#[derive(Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<u64>,           // None for notifications
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
    pub method: Option<String>,    // Present for notifications
    pub params: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

// === ACP-Specific ===

#[derive(Serialize)]
pub struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    #[serde(rename = "clientCapabilities")]
    pub client_capabilities: ClientCapabilities,
    #[serde(rename = "clientInfo")]
    pub client_info: Implementation,
}

#[derive(Serialize)]
pub struct ClientCapabilities {
    // Start with no file/terminal access — chat only
}

#[derive(Serialize)]
pub struct Implementation {
    pub name: String,
    pub version: String,
}

#[derive(Serialize)]
pub struct PromptParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub prompt: Vec<ContentBlock>,
}

#[derive(Serialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub content_type: String,  // "text"
    pub text: String,
}

// === Events sent to frontend ===

#[derive(Clone, Serialize)]
pub struct ChatChunkEvent {
    pub text: String,
    pub done: bool,
}
```

### 5.2 ACP Connection (`src-tauri/src/acp/connection.rs`)

```rust
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

pub struct AcpConnection {
    child: Child,
    next_id: Mutex<u64>,
    session_id: Mutex<Option<String>>,
}

impl AcpConnection {
    /// Spawn Claude Code in ACP mode
    pub fn spawn() -> Result<Self, String> {
        let child = Command::new("claude")
            .arg("--acp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn Claude Code: {}", e))?;

        Ok(Self {
            child,
            next_id: Mutex::new(1),
            session_id: Mutex::new(None),
        })
    }

    /// Send a JSON-RPC request and read the response
    pub fn send_request(&self, method: &str, params: serde_json::Value)
        -> Result<serde_json::Value, String>
    {
        let id = {
            let mut next = self.next_id.lock().unwrap();
            let id = *next;
            *next += 1;
            id
        };

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        // Write to stdin (newline-delimited)
        let stdin = self.child.stdin.as_ref()
            .ok_or("stdin not available")?;
        let line = serde_json::to_string(&request).unwrap() + "\n";
        // ... write line to stdin ...

        // Read response from stdout
        // ... read lines, match by id ...

        Ok(serde_json::Value::Null) // placeholder
    }

    /// Send ACP initialize handshake
    pub fn initialize(&self) -> Result<(), String> {
        let params = serde_json::json!({
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": {
                "name": "employee-data-manager",
                "title": "Employee Data Manager",
                "version": "0.1.0"
            }
        });

        self.send_request("initialize", params)?;
        Ok(())
    }

    /// Create a new ACP session
    pub fn new_session(&self) -> Result<String, String> {
        let result = self.send_request("session/new", serde_json::json!({}))?;
        let session_id = result["sessionId"]
            .as_str()
            .ok_or("No sessionId in response")?
            .to_string();

        *self.session_id.lock().unwrap() = Some(session_id.clone());
        Ok(session_id)
    }

    /// Send a prompt and stream responses
    pub fn send_prompt(&self, message: &str) -> Result<(), String> {
        let session_id = self.session_id.lock().unwrap()
            .clone()
            .ok_or("No active session")?;

        let params = serde_json::json!({
            "sessionId": session_id,
            "prompt": [{
                "type": "text",
                "text": message
            }]
        });

        self.send_request("session/prompt", params)?;
        Ok(())
    }
}
```

### 5.3 Tauri Commands (`src-tauri/src/acp/commands.rs`)

```rust
use tauri::{AppHandle, Emitter, State};
use super::connection::AcpConnection;
use std::sync::Mutex;

pub struct AcpState {
    pub connection: Mutex<Option<AcpConnection>>,
}

#[tauri::command]
pub async fn acp_initialize(state: State<'_, AcpState>) -> Result<(), String> {
    let conn = AcpConnection::spawn()?;
    conn.initialize()?;
    conn.new_session()?;
    *state.connection.lock().unwrap() = Some(conn);
    Ok(())
}

#[tauri::command]
pub async fn acp_send_prompt(
    message: String,
    state: State<'_, AcpState>,
    app: AppHandle,
) -> Result<String, String> {
    let guard = state.connection.lock().unwrap();
    let conn = guard.as_ref().ok_or("ACP not initialized")?;

    // Send prompt — streaming updates are emitted as Tauri events
    // from the stdout reader thread
    conn.send_prompt(&message)?;

    Ok("Message sent".to_string())
}

#[tauri::command]
pub async fn acp_cancel(state: State<'_, AcpState>) -> Result<(), String> {
    let guard = state.connection.lock().unwrap();
    let conn = guard.as_ref().ok_or("ACP not initialized")?;
    // Send session/cancel notification (no response expected)
    // ...
    Ok(())
}

#[tauri::command]
pub async fn acp_shutdown(state: State<'_, AcpState>) -> Result<(), String> {
    let mut guard = state.connection.lock().unwrap();
    if let Some(mut conn) = guard.take() {
        // Close stdin to signal shutdown, then wait for process
        drop(conn);
    }
    Ok(())
}
```

### 5.4 Register Commands (`src-tauri/src/lib.rs`)

```rust
mod acp;

pub fn run() {
    tauri::Builder::default()
        .manage(acp::commands::AcpState {
            connection: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            acp::commands::acp_initialize,
            acp::commands::acp_send_prompt,
            acp::commands::acp_cancel,
            acp::commands::acp_shutdown,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
```

### 5.5 Cargo Dependencies

```toml
# src-tauri/Cargo.toml — add to [dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

---

## 6. TypeScript Implementation Details

### 6.1 Chat Types (`src/types/chat.ts`)

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}
```

### 6.2 Chat Hook (`src/hooks/useChat.ts`)

```typescript
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChatMessage } from '../types/chat';
import { generateId } from '../utils/id';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize ACP connection on mount
  useEffect(() => {
    const init = async () => {
      try {
        await invoke('acp_initialize');
        setIsConnected(true);
      } catch (e) {
        setError(`Failed to connect to Claude: ${e}`);
      }
    };
    init();

    // Cleanup on unmount
    return () => {
      invoke('acp_shutdown').catch(() => {});
    };
  }, []);

  // Listen for streaming message chunks from Rust
  useEffect(() => {
    const unlisten = listen<{ text: string; done: boolean }>('acp:message-chunk', (event) => {
      const { text, done } = event.payload;

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.isStreaming) {
          // Append to existing streaming message
          return prev.map((msg, i) =>
            i === prev.length - 1
              ? { ...msg, content: msg.content + text, isStreaming: !done }
              : msg
          );
        } else {
          // Start new assistant message
          return [...prev, {
            id: generateId(),
            role: 'assistant',
            content: text,
            timestamp: new Date().toISOString(),
            isStreaming: !done,
          }];
        }
      });

      if (done) setIsLoading(false);
    });

    return () => { unlisten.then(fn => fn()); };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!isConnected || isLoading) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      isStreaming: false,
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      await invoke('acp_send_prompt', { message: text });
    } catch (e) {
      setError(`Failed to send message: ${e}`);
      setIsLoading(false);
    }
  }, [isConnected, isLoading]);

  const cancelResponse = useCallback(async () => {
    try {
      await invoke('acp_cancel');
      setIsLoading(false);
    } catch (e) {
      // Ignore cancel errors
    }
  }, []);

  return {
    messages,
    isConnected,
    isLoading,
    error,
    sendMessage,
    cancelResponse,
  };
}
```

### 6.3 Chat Panel Component (`src/components/ChatPanel.tsx`)

```typescript
import { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat';
import { ChatMessage } from './ChatMessage';

export function ChatPanel(): React.JSX.Element {
  const { messages, isConnected, isLoading, error, sendMessage, cancelResponse } = useChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Claude Chat</h3>
        <span className={`chat-status ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask Claude anything about your employees or get help with the app.
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={isConnected ? "Ask Claude..." : "Connecting..."}
          disabled={!isConnected}
          className="chat-input"
        />
        {isLoading ? (
          <button type="button" onClick={cancelResponse} className="chat-cancel-btn">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!isConnected || !input.trim()} className="chat-send-btn">
            Send
          </button>
        )}
      </form>
    </div>
  );
}
```

### 6.4 Chat Message Component (`src/components/ChatMessage.tsx`)

```typescript
import { ChatMessage as ChatMessageType } from '../types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps): React.JSX.Element {
  return (
    <div className={`chat-message chat-message-${message.role}`}>
      <div className="chat-message-header">
        <span className="chat-message-role">
          {message.role === 'user' ? 'You' : 'Claude'}
        </span>
        <span className="chat-message-time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="chat-message-content">
        {message.content}
        {message.isStreaming && <span className="chat-cursor">▊</span>}
      </div>
    </div>
  );
}
```

---

## 7. Layout Integration

### Updated App Layout

The chat panel sits as a collapsible right panel alongside the existing content area:

```
┌──────────┬──────────────────────────────────┬───────────────────┐
│          │                                  │                   │
│ Sidebar  │       Content Area               │    Chat Panel     │
│ (220px)  │       (existing views)           │    (350px)        │
│          │                                  │                   │
│          │                                  │                   │
│          │                                  │                   │
│          │                                  │                   │
└──────────┴──────────────────────────────────┴───────────────────┘
```

### App.tsx Changes

```typescript
// Add to App.tsx
import { ChatPanel } from './components/ChatPanel';

// In the return statement, add ChatPanel after the content area:
return (
  <Layout currentPage={view.page} ...>
    <div className="app-content-with-chat">
      <div className="main-content">
        {content}
      </div>
      <ChatPanel />
    </div>
    {deleteTarget && <DeleteConfirmDialog ... />}
  </Layout>
);
```

### CSS Layout Changes

```css
/* src/App.css — add */
.app-content-with-chat {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow-y: auto;
}
```

---

## 8. Authentication

### Approach: Rely on Claude Code's Existing Auth

Claude Code CLI manages its own authentication (OAuth token stored in macOS Keychain or `ANTHROPIC_API_KEY` env var). Our app doesn't need to handle auth — just spawn Claude Code and it authenticates itself.

### Prerequisites

The user must have:
1. **Claude Code CLI installed**: `npm install -g @anthropic-ai/claude-code` (or equivalent)
2. **Authenticated**: Run `claude` once in a terminal to complete OAuth login
3. **`claude` in PATH**: The Rust `Command::new("claude")` must find the binary

### Error Handling for Auth

If Claude Code isn't installed or authenticated, the `acp_initialize` command will fail. The frontend should show a helpful error:

```
"Could not connect to Claude. Make sure Claude Code CLI is installed
and authenticated. Run 'claude' in your terminal to set up."
```

---

## 9. Cargo Dependencies

### `src-tauri/Cargo.toml`

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["process", "io-util", "sync", "rt"] }
```

**Note:** We use `serde_json` for hand-rolling JSON-RPC messages rather than the `agent-client-protocol` crate. Rationale:

| Approach | Pros | Cons |
|----------|------|------|
| **Hand-rolled JSON-RPC** (chosen) | Zero extra deps, full control, easy to debug | Must define types manually |
| **`agent-client-protocol` crate** | Type-safe, complete ACP types | Pulls in many deps, `!Send` futures need `LocalSet`, adds complexity |

For an MVP chat panel, hand-rolling a few JSON-RPC messages is simpler. If the integration grows, migrate to the official crate.

---

## 10. Implementation Order

### Phase 1 — Rust ACP Client (Backend)

| Step | File | What |
|------|------|------|
| 1 | `src-tauri/Cargo.toml` | Add serde_json, tokio dependencies |
| 2 | `src-tauri/src/acp/types.rs` | Define JSON-RPC + ACP message types |
| 3 | `src-tauri/src/acp/connection.rs` | Subprocess spawn + stdin/stdout I/O |
| 4 | `src-tauri/src/acp/commands.rs` | Tauri IPC commands |
| 5 | `src-tauri/src/acp/mod.rs` | Module exports |
| 6 | `src-tauri/src/lib.rs` | Register commands + managed state |

**Verification:** `cargo build` in `src-tauri/` succeeds.

### Phase 2 — Frontend Chat UI

| Step | File | What |
|------|------|------|
| 7 | `src/types/chat.ts` | ChatMessage and ChatState types |
| 8 | `src/hooks/useChat.ts` | Chat state + Tauri IPC integration |
| 9 | `src/components/ChatMessage.tsx` | Message bubble component |
| 10 | `src/components/ChatPanel.tsx` | Full chat panel with input |
| 11 | `src/styles/chat.css` | Chat panel styles |

**Verification:** `npx tsc --noEmit` passes.

### Phase 3 — Integration

| Step | File | What |
|------|------|------|
| 12 | `src/App.tsx` | Add ChatPanel to layout |
| 13 | `src/App.css` | Flex layout for content + chat |

**Verification:** `npm run tauri dev` — chat panel visible, can send messages.

### Phase 4 — Streaming & Polish

| Step | What |
|------|------|
| 14 | Wire up stdout reader thread in Rust to emit Tauri events |
| 15 | Handle streaming text display (typing effect) |
| 16 | Add cancel button functionality |
| 17 | Handle connection errors gracefully |
| 18 | Add chat panel toggle (show/hide) |
| 19 | Handle Claude Code not installed (helpful error) |

**Verification:** Full end-to-end chat works with streaming responses.

---

## 11. Error Scenarios

| Scenario | How We Handle It |
|----------|-----------------|
| Claude Code CLI not installed | Show "Install Claude Code" message with link |
| Claude Code not authenticated | Show "Run `claude` to authenticate" message |
| Claude Code crashes mid-session | Detect closed stdout, show "Connection lost" + reconnect button |
| Network timeout | ACP is local (stdin/stdout), so network isn't involved |
| Session expired | Catch error, create new session automatically |
| User sends prompt while streaming | Disable input until current response completes |
| Large response | Auto-scroll, virtual scroll if needed (future) |

---

## 12. Future Enhancements (Not in MVP)

These features could be added after the basic chat works:

| Feature | Description |
|---------|-------------|
| **Employee context** | Send employee data as context with prompts |
| **Tool permissions UI** | Show/approve when Claude wants to use tools |
| **Session persistence** | Save chat history, resume sessions across app restarts |
| **Multiple sessions** | Tab-based chat sessions |
| **Markdown rendering** | Render Claude's responses as formatted Markdown |
| **Code highlighting** | Syntax-highlight code blocks in responses |
| **File operations** | Let Claude read/write employee data directly |
| **Chat history search** | Search through past conversations |

---

## 13. Testing Checklist

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | `npm run tauri dev` with Claude Code installed | App opens with chat panel visible |
| 2 | Send "Hello" in chat | Claude responds with a greeting |
| 3 | Send a longer question | Response streams in word-by-word |
| 4 | Click "Stop" during streaming | Response stops, can send new message |
| 5 | Close and reopen app | New session created, previous chat cleared |
| 6 | `npm run tauri dev` without Claude Code | Helpful error message shown in chat panel |
| 7 | Send empty message | Button disabled, nothing sent |
| 8 | Rapid multiple messages | Messages queued, processed in order |
| 9 | Very long response | Chat auto-scrolls, no UI freeze |
| 10 | Resize window | Chat panel adapts, responsive layout |

---

## 14. Reference Links

### ACP Protocol
- **Official site:** https://agentclientprotocol.com
- **Protocol overview:** https://agentclientprotocol.com/protocol/overview
- **GitHub (spec):** https://github.com/agentclientprotocol/agent-client-protocol

### Rust Libraries
- **`agent-client-protocol` crate:** https://crates.io/crates/agent-client-protocol
- **Rust SDK docs:** https://docs.rs/agent-client-protocol
- **Schema types:** https://docs.rs/agent-client-protocol-schema
- **Rust SDK GitHub:** https://github.com/agentclientprotocol/rust-sdk

### Claude Code
- **Claude Code as ACP agent:** https://zed.dev/acp
- **Claude Code ACP adapter (Zed):** https://github.com/zed-industries/claude-agent-acp

### Real-World Reference
- **Solo IDE (Tauri + Claude):** https://www.sachinadlakha.us/blog/desktop-ai-ide-claude-sdk — Tauri v2 app using Claude Agent SDK as sidecar subprocess
- **ACP intro (Goose/Block):** https://block.github.io/goose/blog/2025/10/24/intro-to-agent-client-protocol-acp/

### Existing Project Docs
- **ACP/MCP research:** `docs/06_acp_and_agent_sdk.md`
- **Employee Data Manager plan:** `docs/05_employee_data_upload_plan.md`
