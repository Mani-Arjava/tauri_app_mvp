# 03 — Tauri v2 Framework: Concepts & Reference

## What is Tauri v2?

Tauri is a framework for building **desktop and mobile apps** with a web frontend and a Rust backend. Key characteristics:

- **WebView-based** — uses the OS's native WebView (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux) instead of bundling Chromium
- **Tiny binaries** — a basic app is ~600KB (vs ~150MB for Electron)
- **Secure by default** — capabilities/permissions system controls what the frontend can access
- **Desktop + Mobile** — v2 added Android and iOS support
- **Frontend-agnostic** — React, Vue, Svelte, vanilla JS, etc.

---

## 1. Tauri CLI

The CLI manages your Tauri project — development, building, code generation.

### Installation

```bash
# Option A: npm (recommended for JS/TS projects)
npm install -D @tauri-apps/cli@latest

# Option B: Cargo (standalone Rust binary)
cargo install tauri-cli --locked
```

### Key Commands

| Command | What It Does |
|---------|-------------|
| `tauri init` | Add Tauri to an existing frontend project |
| `tauri dev` | Start dev mode (frontend + Rust backend with hot reload) |
| `tauri build` | Create production binary for current platform |
| `tauri icon <path>` | Generate all icon sizes from a source image (1024x1024 PNG) |
| `tauri info` | Print debug info (OS, Rust version, Tauri version, WebView) |
| `tauri android init` | Initialize Android project |
| `tauri android dev` | Run on Android emulator/device |
| `tauri ios init` | Initialize iOS project |
| `tauri ios dev` | Run on iOS simulator/device |

Usage via npm:

```bash
npx tauri dev
npx tauri build
# or if you added "tauri" to scripts:
npm run tauri dev
```

---

## 2. Tauri JS API (`@tauri-apps/api`)

The JavaScript/TypeScript API for communicating with the Rust backend.

### Core Imports (v2)

```ts
// Call Rust commands
import { invoke } from "@tauri-apps/api/core";

// Event system
import { listen, emit, emitTo, once } from "@tauri-apps/api/event";

// Window management
import { getCurrentWindow } from "@tauri-apps/api/window";
```

> **v2 Breaking Change:** Import from `@tauri-apps/api/core`, NOT `@tauri-apps/api/tauri` (v1 path).

### invoke() — Call Rust Commands

```ts
// Simple call
const greeting = await invoke<string>("greet", { name: "World" });

// With typed response
interface User {
  id: number;
  name: string;
}
const user = await invoke<User>("get_user", { userId: 42 });
```

### Events

```ts
// Listen for events from Rust
const unlisten = await listen<string>("file-changed", (event) => {
  console.log("File changed:", event.payload);
});

// Emit event to Rust
await emit("button-clicked", { action: "save" });

// Listen only once
await once("app-ready", (event) => {
  console.log("App is ready!");
});

// Clean up listener
unlisten();
```

---

## 3. `tauri.conf.json` — Configuration Reference

Located at `src-tauri/tauri.conf.json`. This is the main Tauri configuration file.

### Annotated v2 Structure

```jsonc
{
  // REQUIRED: Unique app identifier (reverse domain notation)
  // Used for: bundle ID, OS app registration, capability scoping
  "identifier": "com.example.my-tauri-app",

  // App metadata
  "productName": "My Tauri App",
  "version": "0.1.0",

  // Build configuration
  "build": {
    // Frontend dev server URL (used during `tauri dev`)
    "devUrl": "http://localhost:5173",

    // Path to built frontend files (used during `tauri build`)
    "frontendDist": "../dist",

    // Commands run before dev/build
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },

  // Application settings
  "app": {
    // Window configuration
    "windows": [
      {
        "title": "My Tauri App",
        "width": 800,
        "height": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],

    // Security settings
    "security": {
      // Content Security Policy
      "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost; connect-src ipc: http://ipc.localhost"
    },

    // Expose invoke() as window.__TAURI__.invoke (useful for debugging)
    "withGlobalTauri": false
  },

  // Bundle/packaging settings
  "bundle": {
    // Whether to create bundles when running `tauri build`
    "active": true,

    // Platform-specific bundle targets
    "targets": "all",

    // macOS-specific
    "macOS": {
      "minimumSystemVersion": "10.15"
    },

    // App icon paths (relative to src-tauri/)
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },

  // Plugin configuration
  "plugins": {}
}
```

### Key Config Notes

| Field | Notes |
|-------|-------|
| `identifier` | **Required.** Must be unique. Use reverse domain: `com.yourname.appname` |
| `devUrl` | Must match your Vite dev server port (default `5173`) |
| `frontendDist` | Relative path from `src-tauri/` to the built frontend (usually `../dist`) |
| `beforeDevCommand` | Tauri runs this before starting dev mode — starts your Vite server |
| `beforeBuildCommand` | Tauri runs this before building — builds your frontend |
| `withGlobalTauri` | Set to `true` to access `window.__TAURI__` in browser DevTools |

---

## 4. Capabilities & Permissions (New in v2)

Tauri v2 replaced v1's `allowlist` with a **capabilities and permissions system**. This is a security-first approach where the frontend has **zero access by default** — you must explicitly grant permissions.

### How It Works

```
Capability (who + what)
  └── Permission (specific access grant)
        └── Scope (optional: restrict to specific paths/URLs)
```

### Capability Files

Located in `src-tauri/capabilities/`. Each JSON file defines a capability:

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "description": "Default permissions for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "dialog:allow-open",
    "fs:allow-read",
    "fs:allow-write"
  ]
}
```

### Permission Identifiers

Format: `<plugin>:<permission-name>`

| Permission | What It Grants |
|-----------|---------------|
| `core:default` | Basic window operations, app events |
| `fs:default` | Basic filesystem access |
| `fs:allow-read` | Read files |
| `fs:allow-write` | Write files |
| `shell:allow-open` | Open URLs in default browser |
| `dialog:allow-open` | Show file open dialog |
| `dialog:allow-save` | Show file save dialog |
| `notification:default` | Show system notifications |

### Scopes — Restrict Access

```json
{
  "identifier": "restricted-fs",
  "windows": ["main"],
  "permissions": [
    {
      "identifier": "fs:allow-read",
      "allow": [
        { "path": "$APPDATA/**" },
        { "path": "$HOME/Documents/**" }
      ],
      "deny": [
        { "path": "$HOME/.ssh/**" }
      ]
    }
  ]
}
```

### Permission Sets — Group Permissions

For custom commands, define permission sets in your plugin or app:

```json
// src-tauri/capabilities/editor.json
{
  "identifier": "editor-capabilities",
  "description": "Permissions for the editor window",
  "windows": ["editor"],
  "permissions": [
    "core:default",
    "fs:allow-read",
    "fs:allow-write",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

---

## 5. CSP (Content Security Policy)

Tauri enforces CSP to prevent XSS attacks. Configure in `tauri.conf.json`:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost; connect-src ipc: http://ipc.localhost; script-src 'self'"
    }
  }
}
```

| Directive | Purpose |
|-----------|---------|
| `default-src 'self'` | Only load resources from the app itself |
| `connect-src ipc: http://ipc.localhost` | Allow IPC communication with Rust backend |
| `img-src 'self' asset:` | Allow images from app and asset protocol |
| `script-src 'self'` | Only execute scripts bundled with the app |

If you need to load external resources (fonts, CDN scripts), add their domains to the appropriate directive.

---

## 6. Commands (IPC)

Commands are the primary way to call Rust from JavaScript. This is Tauri's IPC (inter-process communication) mechanism.

### Define a Command (Rust)

```rust
// src-tauri/src/lib.rs

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// Register the command
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Call from JavaScript

```ts
import { invoke } from "@tauri-apps/api/core";

const message = await invoke<string>("greet", { name: "Tauri" });
console.log(message); // "Hello, Tauri!"
```

### Arguments: camelCase ↔ snake_case

JavaScript sends camelCase, Rust receives snake_case. Tauri converts automatically:

```ts
// JavaScript — camelCase
await invoke("save_file", { fileName: "test.txt", fileContent: "hello" });
```

```rust
// Rust — snake_case
#[tauri::command]
fn save_file(file_name: &str, file_content: &str) -> Result<(), String> {
    std::fs::write(file_name, file_content).map_err(|e| e.to_string())
}
```

### Return Types

Return types must implement `serde::Serialize`:

```rust
use serde::Serialize;

#[derive(Serialize)]
struct User {
    id: u32,
    name: String,
    email: String,
}

#[tauri::command]
fn get_user(id: u32) -> User {
    User {
        id,
        name: "Alice".into(),
        email: "alice@example.com".into(),
    }
}
```

### Error Handling

Use `Result<T, E>` with `thiserror` for clean error handling:

```rust
use thiserror::Error;
use serde::Serialize;

#[derive(Debug, Error)]
enum AppError {
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Tauri requires errors to be serializable
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
fn read_file(path: &str) -> Result<String, AppError> {
    std::fs::read_to_string(path).map_err(AppError::from)
}
```

Handle errors in JavaScript:

```ts
try {
  const content = await invoke<string>("read_file", { path: "/some/file.txt" });
} catch (error) {
  console.error("Rust error:", error); // "File not found: ..."
}
```

### Async Commands

```rust
#[tauri::command]
async fn fetch_data(url: String) -> Result<String, String> {
    // Runs on a separate thread, doesn't block the main thread
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}
```

### Managed State

Share state across commands using `tauri::State<T>`:

```rust
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    counter: Mutex<i32>,
}

#[tauri::command]
fn increment(state: tauri::State<AppState>) -> i32 {
    let mut counter = state.counter.lock().unwrap();
    *counter += 1;
    *counter
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            counter: Mutex::new(0),
        })
        .invoke_handler(tauri::generate_handler![increment])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Channels — Streaming Data to Frontend

Use `tauri::ipc::Channel` for streaming large or progressive data:

```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Clone, Serialize)]
struct ProgressPayload {
    percent: u32,
    message: String,
}

#[tauri::command]
fn process_files(on_progress: Channel<ProgressPayload>) -> Result<(), String> {
    for i in 0..=100 {
        on_progress
            .send(ProgressPayload {
                percent: i,
                message: format!("Processing {}%", i),
            })
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Ok(())
}
```

```ts
import { invoke, Channel } from "@tauri-apps/api/core";

const onProgress = new Channel<{ percent: number; message: string }>();
onProgress.onmessage = (progress) => {
  console.log(`${progress.percent}%: ${progress.message}`);
};

await invoke("process_files", { onProgress });
```

---

## 7. Events

Events provide **bidirectional, decoupled** communication between frontend and backend.

### Frontend → Backend

```ts
import { emit } from "@tauri-apps/api/event";

// Emit to all listeners (frontend + backend)
await emit("user-action", { type: "click", target: "save-btn" });
```

```rust
use tauri::Listener;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.listen("user-action", |event| {
                println!("Got event: {:?}", event.payload());
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Backend → Frontend

```rust
use tauri::Emitter;

#[tauri::command]
fn start_task(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Do work...
        app.emit("task-complete", "done").unwrap();
    });
}
```

```ts
import { listen } from "@tauri-apps/api/event";

const unlisten = await listen<string>("task-complete", (event) => {
  console.log("Task finished:", event.payload);
});
```

### Targeted Events

```ts
import { emitTo } from "@tauri-apps/api/event";

// Send to a specific window
await emitTo("settings-window", "theme-changed", { theme: "dark" });
```

---

## 8. Commands vs Events

| Feature | Commands (`invoke`) | Events (`emit`/`listen`) |
|---------|-------------------|------------------------|
| Direction | Frontend → Backend (request/response) | Bidirectional (fire-and-forget) |
| Return value | Yes (via Promise) | No (one-way) |
| Use case | Call a function and get a result | Notify about state changes |
| Error handling | `try/catch` on the Promise | No built-in error handling |
| Analogy | REST API call | WebSocket message |

**Rule of thumb:**
- Need a result? → Use a **command**
- Broadcasting a notification? → Use an **event**

---

## 9. Key Cargo Dependencies

Add these to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"          # For opening URLs, running shell commands
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"                    # For clean error types

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

### Common Tauri Plugins (v2)

| Plugin | Crate | npm Package | Purpose |
|--------|-------|-------------|---------|
| Shell | `tauri-plugin-shell` | `@tauri-apps/plugin-shell` | Open URLs, run CLI commands |
| File System | `tauri-plugin-fs` | `@tauri-apps/plugin-fs` | Read/write files |
| Dialog | `tauri-plugin-dialog` | `@tauri-apps/plugin-dialog` | File open/save dialogs |
| Notification | `tauri-plugin-notification` | `@tauri-apps/plugin-notification` | System notifications |
| Store | `tauri-plugin-store` | `@tauri-apps/plugin-store` | Key-value persistent storage |
| HTTP | `tauri-plugin-http` | `@tauri-apps/plugin-http` | HTTP client |

---

← [02 — Rust Setup](./02_rust_setup.md) | **Next:** [04 — Create Tauri App](./04_create_tauri_app.md) →
