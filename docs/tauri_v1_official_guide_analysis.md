# Tauri v2 Official Guide — Comprehensive Analysis

> Source: [https://tauri.app/start/](https://tauri.app/start/)
> Analyzed on: 2026-03-23

---

## Table of Contents

1. [Guide Structure Overview](#1-guide-structure-overview)
2. [Prerequisites & Setup](#2-prerequisites--setup)
3. [Architecture & Core Concepts](#3-architecture--core-concepts)
4. [Commands (Frontend ↔ Rust IPC)](#4-commands-frontend--rust-ipc)
5. [Event System](#5-event-system)
6. [Configuration (tauri.conf.json)](#6-configuration-tauriconfjson)
7. [Features Deep Dive](#7-features-deep-dive)
8. [Building & Distribution](#8-building--distribution)
9. [Auto-Updater](#9-auto-updater)
10. [Testing](#10-testing)
11. [Debugging](#11-debugging)
12. [FAQ & Common Pitfalls](#12-faq--common-pitfalls)
13. [Key Takeaways for MVP Development](#13-key-takeaways-for-mvp-development)

---

## 1. Guide Structure Overview

The official Tauri v2 docs are organized into these primary sections:

| Section         | Purpose                                       |
|-----------------|-----------------------------------------------|
| Start           | Prerequisites, project scaffolding, frontend setup |
| Develop         | Commands, events, plugins, calling Rust        |
| Distribute      | Building, bundling, updater, publishing        |
| References      | Configuration, CLI, JavaScript API, Rust API   |
| Concepts        | Architecture, IPC, security (capabilities)     |
| Mobile          | Android and iOS setup, platform differences    |

---

## 2. Prerequisites & Setup

### System Requirements (per OS)

**macOS:**
- Xcode Command Line Tools: `xcode-select --install`
- Rust: `curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh`

**Windows:**
- Visual Studio C++ Build Tools 2022 (with Windows 10 SDK)
- WebView2 (pre-installed on Win10 1803+ and Win11)
- Rust via `rustup` with MSVC toolchain: `rustup default stable-msvc`

**Linux (Debian/Ubuntu):**
- System packages: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
- Rust (same as macOS)

**Required:** Node.js LTS (for React frontend and Tauri CLI via npm)

### Project Scaffolding

```bash
# Using npm
npm create tauri-app@latest

# Or initialize in existing project
npx tauri init
```

This generates `src-tauri/` containing:
- `Cargo.toml` — Rust dependencies
- `tauri.conf.json` — App configuration
- `build.rs` — Tauri build script (do not modify)
- `src/lib.rs` — App logic & commands (shared by desktop and mobile)
- `src/main.rs` — Desktop entry point (calls `lib.rs`)
- `icons/` — Default app icons
- `capabilities/` — Permission/capability files (replaces v1 allowlist)

> See [04 — Create Tauri App](./04_create_tauri_app.md) for full scaffolding walkthrough.

---

## 3. Architecture & Core Concepts

### Three-Layer Model

```
┌─────────────────────────────────┐
│   Frontend (WebView)            │  HTML/CSS/JS, React, Vue, etc.
│   - UI rendering                │  Uses fetch() for external APIs
│   - User interaction            │  Uses invoke() for Rust commands
├─────────────────────────────────┤
│   IPC Layer                     │  Serialized message passing
│   - invoke() → command          │  Frontend → Backend
│   - event emit/listen           │  Bidirectional
│   - Channel streaming           │  Backend → Frontend (progressive)
├─────────────────────────────────┤
│   Backend (Rust Core)           │  #[tauri::command] functions
│   - System-level operations     │  File access, OS integration
│   - Security enforcement        │  Capabilities & permissions
│   - State management            │  tauri::State<T>
│   - Plugins                     │  Shell, FS, Dialog, etc.
└─────────────────────────────────┘

    Supports: Desktop (macOS, Windows, Linux) + Mobile (Android, iOS)
```

### `lib.rs` + `main.rs` Split

Tauri v2 supports mobile platforms, so app logic is split across two files:

- **`lib.rs`** — Contains all your commands, plugins, state, and the `run()` function. Shared by desktop and mobile.
- **`main.rs`** — Desktop-only entry point. Just calls `app_lib::run()`.
- On mobile, Tauri generates a separate entry point that also calls `run()`.

```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    app_lib::run()
}
```

### Key Principle: Separation of Concerns

| Task                     | Where it belongs       |
|--------------------------|------------------------|
| API calls (REST/GraphQL) | Frontend (fetch/axios) |
| UI rendering             | Frontend               |
| File system access       | Rust backend           |
| OS-level integrations    | Rust backend           |
| Secret/key management    | Rust backend           |
| Input validation         | Rust backend           |

### WebView (Not Chromium)

Tauri uses the **OS native WebView** instead of bundling Chromium:
- **macOS** → WebKit (Safari engine)
- **Windows** → WebView2 (Edge/Chromium engine)
- **Linux** → WebKitGTK
- **Android** → Android WebView
- **iOS** → WKWebView

This results in ~600KB–3MB app sizes vs 150MB+ for Electron.

---

## 4. Commands (Frontend ↔ Rust IPC)

This is the **most critical section** for building any Tauri app.

### Defining a Command (Rust)

Commands are defined in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// Register in lib.rs run() function
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Calling from Frontend (JS/TS)

```typescript
import { invoke } from "@tauri-apps/api/core";

// Arguments auto-convert: snake_case (Rust) → camelCase (JS)
const result = await invoke<string>("greet", { name: "Mani" });
console.log(result); // "Hello, Mani!"
```

> **v2 import path:** `@tauri-apps/api/core` — NOT `@tauri-apps/api/tauri` (that was v1).

### Error Handling

```rust
#[tauri::command]
fn risky_operation() -> Result<String, String> {
    // Return Ok for success, Err for failure
    Err("Something went wrong".into())
}
```

```javascript
invoke("risky_operation")
    .then((msg) => console.log(msg))
    .catch((err) => console.error(err)); // "Something went wrong"
```

For type-safe errors, use `thiserror` with a custom error type implementing `serde::Serialize`:

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

### Async Commands (Prevent UI Freezing)

```rust
#[tauri::command]
async fn long_running_task(value: String) -> Result<String, String> {
    // Heavy work here...
    Ok(format!("Done: {}", value))
}
```

**Important:** Async commands cannot use borrowed types (`&str`). Use owned types (`String`) instead.

### Accessing Window & AppHandle

```rust
#[tauri::command]
async fn get_window_info(window: tauri::Window) {
    println!("Called from window: {}", window.label());
}

#[tauri::command]
async fn get_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = app_handle.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
```

### Managed State

```rust
use std::sync::Mutex;

struct AppState {
    db_url: String,
    counter: Mutex<i32>,
}

#[tauri::command]
fn increment(state: tauri::State<AppState>) -> i32 {
    let mut counter = state.counter.lock().unwrap();
    *counter += 1;
    *counter
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            db_url: "sqlite://app.db".into(),
            counter: Mutex::new(0),
        })
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![increment])
        .run(tauri::generate_context!())
        .expect("error");
}
```

### Channels — Streaming Data to Frontend

Tauri v2 introduces `tauri::ipc::Channel<T>` for streaming progressive data from Rust to the frontend:

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

```typescript
import { invoke, Channel } from "@tauri-apps/api/core";

const onProgress = new Channel<{ percent: number; message: string }>();
onProgress.onmessage = (progress) => {
    console.log(`${progress.percent}%: ${progress.message}`);
};

await invoke("process_files", { onProgress });
```

### Registering Multiple Commands

```rust
// All commands in ONE generate_handler! call
.invoke_handler(tauri::generate_handler![cmd_a, cmd_b, cmd_c])
// ⚠️ Calling invoke_handler multiple times only keeps the LAST one
```

---

## 5. Event System

A **multi-producer multi-consumer** channel for message passing — especially useful for backend-to-frontend communication.

### Frontend → Listen & Emit

```typescript
import { listen, emit } from "@tauri-apps/api/event";

// Listen for events from Rust
const unlisten = await listen("download-progress", (event) => {
    console.log(`Progress: ${event.payload}%`);
});

// Emit events to Rust
await emit("start-download", { url: "https://example.com/file.zip" });

// Cleanup
unlisten();
```

`once()` — auto-unsubscribes after first event.

### Backend → Emit & Listen (Rust)

```rust
use tauri::Emitter;
use tauri::Listener;

// Emit to all frontend windows (v2: use Emitter trait)
app.emit("download-progress", 75)?;

// Emit to specific window
window.emit("update-ready", payload)?;

// Listen for events (v2: use Listener trait)
app.listen("start-download", |event| {
    println!("Received: {:?}", event.payload());
});
```

### Targeted Events

```typescript
import { emitTo } from "@tauri-apps/api/event";

// Send to a specific window
await emitTo("settings-window", "theme-changed", { theme: "dark" });
```

### Window-Specific Events

Events can be scoped to individual windows — useful for multi-window apps where only one window should react.

### Commands vs Events — When to Use Which

| Use Case                        | Mechanism  |
|---------------------------------|------------|
| Frontend requests data          | Command    |
| Frontend triggers action        | Command    |
| Backend pushes updates          | Event      |
| Background task progress        | Event / Channel |
| Bidirectional real-time stream  | Event      |

**Rule of thumb:**
- Need a result? → Use a **command**
- Broadcasting a notification? → Use an **event**
- Streaming progressive data? → Use a **channel**

> See [03 — Tauri Setup, Events](./03_tauri_setup.md#7-events) for more examples.

---

## 6. Configuration (tauri.conf.json)

### Core Structure (v2 — Flat Layout)

Tauri v2 uses a **flat configuration structure** — no `"tauri"` wrapper. Key fields moved to top level.

```jsonc
{
    // REQUIRED: Unique app identifier (reverse domain notation)
    "identifier": "com.myapp.dev",

    // App metadata (top-level, not nested under "package")
    "productName": "My App",
    "version": "1.0.0",

    // Build configuration
    "build": {
        "devUrl": "http://localhost:5173",       // was: devPath
        "frontendDist": "../dist",               // was: distDir
        "beforeDevCommand": "npm run dev",
        "beforeBuildCommand": "npm run build"
    },

    // Application settings (was: tauri.windows, tauri.security)
    "app": {
        "windows": [
            {
                "title": "My App",
                "width": 1024,
                "height": 768,
                "resizable": true,
                "fullscreen": false
            }
        ],
        "security": {
            "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost; connect-src ipc: http://ipc.localhost"
        },
        "withGlobalTauri": false
    },

    // Bundle/packaging settings
    "bundle": {
        "active": true,
        "targets": "all",
        "icon": [
            "icons/32x32.png",
            "icons/128x128.png",
            "icons/128x128@2x.png",
            "icons/icon.icns",
            "icons/icon.ico"
        ],
        "macOS": {
            "minimumSystemVersion": "10.15"
        }
    },

    // Plugin configuration
    "plugins": {}
}
```

### Key v2 Config Changes

| v1 Field                    | v2 Field                | Notes                         |
|-----------------------------|-------------------------|-------------------------------|
| `package.productName`       | `productName`           | Top-level                     |
| `build.devPath`             | `build.devUrl`          | Renamed                       |
| `build.distDir`             | `build.frontendDist`    | Renamed                       |
| `tauri.windows`             | `app.windows`           | Moved under `app`             |
| `tauri.security`            | `app.security`          | Moved under `app`             |
| `tauri.allowlist`           | *(removed)*             | Replaced by capabilities      |
| `tauri.systemTray`          | *(removed)*             | Now plugin-based              |
| `tauri.updater`             | *(removed)*             | Now plugin-based              |
| `tauri.bundle`              | `bundle`                | Top-level                     |
| *(new)*                     | `identifier`            | Required, top-level           |
| *(new)*                     | `app.withGlobalTauri`   | Expose `window.__TAURI__`     |
| *(new)*                     | `plugins`               | Plugin config section         |

> See [03 — Tauri Setup, Configuration](./03_tauri_setup.md#3-tauriconfjson--configuration-reference) for annotated reference.

---

## 7. Features Deep Dive

### 7.1 Multi-Window

**Static (in config):**
```json
{
    "app": {
        "windows": [
            { "label": "main", "url": "index.html" },
            { "label": "settings", "url": "settings.html" }
        ]
    }
}
```

**Dynamic (Rust runtime):**
```rust
use tauri::WebviewUrl;

// In setup hook or command
tauri::WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
    .title("Settings")
    .build()?;
```

**Dynamic (JavaScript):**
```typescript
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const settingsWindow = new WebviewWindow("settings", {
    url: "settings.html",
    title: "Settings",
});

settingsWindow.once("tauri://created", () => { /* success */ });
settingsWindow.once("tauri://error", (e) => { /* handle error */ });
```

**Important:** When creating windows in Tauri commands, use `async` functions to prevent deadlocks on Windows.

Inter-window communication uses the **event system** (including `emitTo()` for targeted messages).

### 7.2 System Tray

In Tauri v2, the system tray is **plugin-based** using `tauri-plugin-tray`:

```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().unwrap();
                                window.set_focus().unwrap();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Features: left/right/double click detection, dynamic icon updates, dynamic menu updates, keep app running in background.

### 7.3 Splash Screen

Two approaches:

1. **Webpage loading** — Show splash until frontend JS reports ready, then `invoke('close_splashscreen')`
2. **Rust initialization** — Show splash during heavy setup work, close from `setup()` hook

Config pattern:
```json
{
    "app": {
        "windows": [
            { "label": "main", "visible": false, "url": "index.html" },
            { "label": "splashscreen", "url": "splashscreen.html", "decorations": false }
        ]
    }
}
```

### 7.4 App Icons

Generate all platform icons from a single 1024x1024 PNG:

```bash
npm run tauri icon ./app-icon.png
```

Generates:
- `.icns` (macOS)
- `.ico` (Windows)
- Multiple `.png` sizes (Linux, generic)

### 7.5 CLI Integration

Tauri apps can accept command-line arguments via the CLI plugin:

```json
{
    "plugins": {
        "cli": {
            "description": "My Tauri App",
            "args": [
                { "name": "input", "short": "i", "takesValue": true }
            ],
            "subcommands": {
                "export": { "description": "Export data" }
            }
        }
    }
}
```

### 7.6 Plugins

Tauri v2 moved most built-in APIs to an **official plugin system**. Each plugin has a Rust crate and an npm package:

| Plugin | Crate | npm Package | Purpose |
|--------|-------|-------------|---------|
| Shell | `tauri-plugin-shell` | `@tauri-apps/plugin-shell` | Open URLs, run CLI commands |
| File System | `tauri-plugin-fs` | `@tauri-apps/plugin-fs` | Read/write files |
| Dialog | `tauri-plugin-dialog` | `@tauri-apps/plugin-dialog` | File open/save dialogs |
| Notification | `tauri-plugin-notification` | `@tauri-apps/plugin-notification` | System notifications |
| Store | `tauri-plugin-store` | `@tauri-apps/plugin-store` | Key-value persistent storage |
| HTTP | `tauri-plugin-http` | `@tauri-apps/plugin-http` | HTTP client from Rust side |
| Updater | `tauri-plugin-updater` | `@tauri-apps/plugin-updater` | Auto-update mechanism |
| Clipboard | `tauri-plugin-clipboard-manager` | `@tauri-apps/plugin-clipboard-manager` | Read/write clipboard |
| Global Shortcut | `tauri-plugin-global-shortcut` | `@tauri-apps/plugin-global-shortcut` | System-wide keyboard shortcuts |
| Process | `tauri-plugin-process` | `@tauri-apps/plugin-process` | Exit, relaunch |

**To add a plugin:**

```bash
# Rust side (in src-tauri/)
cargo add tauri-plugin-shell

# JS side (in project root)
npm install @tauri-apps/plugin-shell
```

Then register in `lib.rs`:
```rust
.plugin(tauri_plugin_shell::init())
```

> See [03 — Tauri Setup, Key Cargo Dependencies](./03_tauri_setup.md#9-key-cargo-dependencies) for more details.

### 7.7 Capabilities & Permissions

Tauri v2 replaced the v1 `allowlist` with a **capabilities and permissions system**. The frontend has **zero access by default** — you must explicitly grant permissions.

**How it works:**
```
Capability (who + what)
  └── Permission (specific access grant)
        └── Scope (optional: restrict to specific paths/URLs)
```

**Capability files** are located in `src-tauri/capabilities/`:

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

**Permission identifier format:** `<plugin>:<permission-name>`

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

**Scopes** can restrict access to specific paths:

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

> See [03 — Tauri Setup, Capabilities](./03_tauri_setup.md#4-capabilities--permissions-new-in-v2) for full reference.

---

## 8. Building & Distribution

### Build Command

```bash
npm run tauri build
# or
cargo tauri build
```

### Platform Output Formats

| Platform | Formats                              |
|----------|--------------------------------------|
| Windows  | `.exe` (NSIS installer), `.msi`      |
| macOS    | `.app` bundle, `.dmg`                |
| Linux    | `.deb`, `.AppImage`, `.rpm`          |

### Cross-Platform via GitHub Actions

**Tauri cannot cross-compile natively.** Use CI/CD with a build matrix:

```yaml
strategy:
  matrix:
    include:
      - platform: macos-latest
        args: '--target aarch64-apple-darwin'   # M1+
      - platform: macos-latest
        args: '--target x86_64-apple-darwin'    # Intel
      - platform: ubuntu-22.04
        args: ''
      - platform: windows-latest
        args: ''
```

Use the official **tauri-apps/tauri-action@v0** GitHub Action for automated builds and releases (v0 supports Tauri v2).

### Debug Builds

```bash
npm run tauri build -- --debug
```

Produces an unoptimized build with DevTools enabled — useful for production debugging.

---

## 9. Auto-Updater

In Tauri v2, the updater is **plugin-based** using `tauri-plugin-updater`.

### Setup

```bash
# Rust side
cargo add tauri-plugin-updater

# JS side
npm install @tauri-apps/plugin-updater
```

Register in `lib.rs`:
```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

Add permission in `src-tauri/capabilities/default.json`:
```json
{
    "permissions": [
        "core:default",
        "updater:default"
    ]
}
```

### Key Generation

```bash
npm run tauri signer generate -- -w ~/.tauri/myapp.key
```

Produces a **public key** (goes in config) and **private key** (keep secret, used for signing).

**Critical:** Losing the private key = no more updates for existing users.

### Configuration

```json
{
    "plugins": {
        "updater": {
            "endpoints": [
                "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"
            ],
            "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ..."
        }
    }
}
```

Template variables: `{{current_version}}`, `{{target}}` (linux/windows/darwin), `{{arch}}` (x86_64/aarch64)

### Build Signed Updates

```bash
export TAURI_SIGNING_PRIVATE_KEY="content of private key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your password"
npm run tauri build
```

Generates `.tar.gz` + `.sig` (macOS/Linux) or `.zip` + `.sig` (Windows).

### Server Response Format

```json
{
    "version": "1.2.0",
    "notes": "Bug fixes and improvements",
    "pub_date": "2026-03-23T10:00:00Z",
    "platforms": {
        "darwin-x86_64": {
            "signature": "content of .sig file",
            "url": "https://releases.myapp.com/myapp.app.tar.gz"
        },
        "linux-x86_64": {
            "signature": "...",
            "url": "https://releases.myapp.com/myapp.AppImage.tar.gz"
        },
        "windows-x86_64": {
            "signature": "...",
            "url": "https://releases.myapp.com/myapp.nsis.zip"
        }
    }
}
```

### Custom Update UI (JavaScript)

```typescript
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const update = await check();
if (update) {
    console.log(`Update available: ${update.version}`);
    await update.downloadAndInstall();
    await relaunch();
}
```

---

## 10. Testing

### Recommended Approach

Tauri's testing story continues to evolve. For production apps:

- **Unit test Rust commands** — Test your `#[tauri::command]` functions independently with standard `#[cfg(test)]` modules
- **Frontend tests with Vitest** — Standard React testing for components and hooks
- **E2E testing** — Optional; use WebDriver-based testing with `tauri-driver` on Linux/Windows CI

### Example: Unit Testing a Rust Command

```rust
#[tauri::command]
fn calculate_sum(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_sum() {
        assert_eq!(calculate_sum(2, 3), 5);
        assert_eq!(calculate_sum(-1, 1), 0);
    }
}
```

---

## 11. Debugging

### Rust Backend

```bash
# Enable full stack traces
RUST_BACKTRACE=1 npm run tauri dev

# Use println! for quick debugging
println!("Debug: {:?}", my_variable);
```

### Frontend (WebView DevTools)

- **macOS:** `Cmd + Option + I`
- **Windows/Linux:** `Ctrl + Shift + I`
- Or right-click → "Inspect Element"

### Programmatic DevTools

```rust
// Open DevTools in code (debug builds only)
window.open_devtools();
window.close_devtools();
```

### Production Debug Build

```bash
npm run tauri build -- --debug
```

Or enable permanently in `Cargo.toml`:
```toml
[features]
devtools = ["tauri/devtools"]
```

**Warning:** Using devtools on macOS violates App Store policies.

### Core Process (Rust) Debugging

Use **GDB** or **LLDB** for Rust-level debugging. VS Code's LLDB extension is recommended.

### Tauri Info

Print useful debug information about your environment:
```bash
npx tauri info
```

---

## 12. FAQ & Common Pitfalls

### Browser Compatibility

Target: `es2021`, `last 3 Chrome versions`, `safari 13`

Each OS uses different rendering engines — test on all platforms.

### Linux + Homebrew Conflict

Homebrew's `pkg-config` can break Linux builds. Fix:
```bash
export PKG_CONFIG_PATH="/usr/lib/pkgconfig:/usr/share/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig"
```

### Version Control

- **Commit:** `src-tauri/Cargo.lock`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/`
- **Ignore:** `src-tauri/target/`, `src-tauri/gen/`

### Capabilities Not Working

If `invoke()` returns a permission error, ensure the required permission is listed in `src-tauri/capabilities/default.json`. Each plugin needs its permissions explicitly granted.

### Import Path Errors

Use `@tauri-apps/api/core` for `invoke`, NOT `@tauri-apps/api/tauri` (v1 path). Plugin APIs use `@tauri-apps/plugin-<name>`, NOT `@tauri-apps/api/<name>`.

---

## 13. Key Takeaways for MVP Development

### Do's

1. **Use commands for all frontend → backend communication** — they're typed, async-friendly, and return Results
2. **Use events for backend → frontend pushes** — progress updates, background task completion
3. **Keep API calls in frontend** (fetch/axios) — only use Rust for system-level ops
4. **Use managed state** (`tauri::State<T>`) for shared app data
5. **Configure capabilities** — grant only the permissions your app actually needs
6. **Register plugins** in `lib.rs` for any native API access (shell, fs, dialog, etc.)
7. **Set CSP headers** in `app.security` section of `tauri.conf.json`
8. **Use async commands** for anything that takes time
9. **Generate icons early** with `tauri icon` from a 1024x1024 PNG

### Don'ts

1. **Don't route external API calls through Rust** unless you need to hide secrets
2. **Don't use borrowed types in async commands** — use `String` not `&str`
3. **Don't call `invoke_handler` multiple times** — only the last one registers
4. **Don't skip capabilities** — they're your primary security boundary
5. **Don't expect cross-compilation** — use GitHub Actions for multi-platform builds
6. **Don't store secrets in the frontend** — keep them in Rust/backend
7. **Don't put command logic in `main.rs`** — use `lib.rs` (required for mobile support)

### MVP Quick Start Checklist

- [ ] Install prerequisites for your OS ([01](./01_react_setup.md), [02](./02_rust_setup.md))
- [ ] Scaffold with `npm create tauri-app@latest` (pick React/TypeScript) ([04](./04_create_tauri_app.md))
- [ ] Configure `tauri.conf.json` (window size, title, identifier)
- [ ] Set up capabilities in `src-tauri/capabilities/default.json`
- [ ] Create Rust commands in `src-tauri/src/lib.rs`
- [ ] Register plugins in `lib.rs` (shell, fs, dialog as needed)
- [ ] Use `invoke()` from `@tauri-apps/api/core` in React to call Rust commands
- [ ] Use events for real-time backend → frontend updates
- [ ] Generate app icons
- [ ] Test with `tauri dev`, build with `tauri build`
- [ ] Set up GitHub Actions for cross-platform CI/CD

> Cross-reference: [01 — React Setup](./01_react_setup.md) · [02 — Rust Setup](./02_rust_setup.md) · [03 — Tauri Setup](./03_tauri_setup.md) · [04 — Create Tauri App](./04_create_tauri_app.md)
