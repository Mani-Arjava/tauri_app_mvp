# 04 — Create a Tauri v2 App (Step-by-Step)

This guide walks through creating a new Tauri v2 app from scratch, understanding the generated code, and running your first custom command.

**Prerequisites:** Complete [01 — React Setup](./01_react_setup.md) and [02 — Rust Setup](./02_rust_setup.md) first.

---

## Method A: Quick Start (Recommended)

Use the official scaffolding tool:

```bash
# Run the create-tauri-app scaffolding
npm create tauri-app@latest
```

You'll be prompted for:

| Prompt | Recommended Choice |
|--------|--------------------|
| Project name | `my-tauri-app` |
| Identifier | `com.yourname.my-tauri-app` |
| Language for frontend | TypeScript / JavaScript |
| Package manager | npm |
| UI template | React |
| UI flavor | TypeScript |

Then:

```bash
cd my-tauri-app
npm install
npm run tauri dev
```

The first build takes 2–5 minutes (compiling Rust dependencies). Subsequent builds are much faster.

---

## Method B: Add Tauri to Existing Vite Project

If you already have a Vite + React project (from [Doc 01](./01_react_setup.md)):

### Step 1: Install Tauri packages

```bash
cd my-vite-project

# CLI (dev tool)
npm install -D @tauri-apps/cli@latest

# JS API (runtime)
npm install @tauri-apps/api@latest
```

### Step 2: Initialize Tauri

```bash
npx tauri init
```

You'll be prompted:

| Prompt | Answer |
|--------|--------|
| App name | `my-tauri-app` |
| Window title | `My Tauri App` |
| Frontend dev URL | `http://localhost:5173` |
| Frontend dev command | `npm run dev` |
| Frontend build command | `npm run build` |
| Frontend dist directory | `../dist` |

This creates the `src-tauri/` directory with all Rust boilerplate.

### Step 3: Add tauri script to package.json

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  }
}
```

### Step 4: Run

```bash
npm run tauri dev
```

---

## Project Structure (v2)

After scaffolding, your project looks like this:

```
my-tauri-app/
├── package.json              # Node.js dependencies & scripts
├── tsconfig.json             # TypeScript configuration
├── vite.config.ts            # Vite bundler config
├── index.html                # HTML entry point
│
├── src/                      # React frontend
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Main React component (has invoke example)
│   ├── App.css               # App styles
│   └── assets/               # Static assets (images, fonts)
│
└── src-tauri/                # Rust backend
    ├── Cargo.toml            # Rust dependencies
    ├── tauri.conf.json       # Tauri configuration
    ├── build.rs              # Tauri build script (do not modify)
    ├── icons/                # App icons (generated via `tauri icon`)
    │
    ├── capabilities/         # Permission/capability files (NEW in v2)
    │   └── default.json      # Default permissions for main window
    │
    └── src/
        ├── lib.rs            # Rust commands + app setup (shared by desktop & mobile)
        └── main.rs           # Desktop entry point (calls lib.rs)
```

### Why `lib.rs` + `main.rs`?

Tauri v2 supports mobile platforms. The architecture splits:

- **`lib.rs`** — Contains all your app logic, commands, and the `run()` function. Shared by all platforms.
- **`main.rs`** — Desktop-only entry point. Just calls `lib::run()`.
- On mobile, Tauri generates a separate entry point that also calls `lib::run()`.

This means you write your code once in `lib.rs` and it works on desktop, Android, and iOS.

---

## Understanding the Generated Code

### `src-tauri/src/lib.rs`

```rust
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register plugins here
        .plugin(tauri_plugin_shell::init())
        // Register commands here
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Key parts:**

| Code | Purpose |
|------|---------|
| `#[tauri::command]` | Makes `greet` callable from JavaScript |
| `#[cfg_attr(mobile, tauri::mobile_entry_point)]` | On mobile, this becomes the entry point |
| `tauri::Builder::default()` | Builds the Tauri app with configuration |
| `.plugin(tauri_plugin_shell::init())` | Registers the shell plugin |
| `.invoke_handler(tauri::generate_handler![greet])` | Registers `greet` as an IPC command |
| `tauri::generate_context!()` | Reads `tauri.conf.json` at compile time |

### `src-tauri/src/main.rs`

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run()
}
```

This just calls the `run()` function from `lib.rs`. Don't add command logic here.

### `src/App.tsx`

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Call the Rust `greet` command
    const message = await invoke<string>("greet", { name });
    setGreetMsg(message);
  }

  return (
    <main>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
```

**Key parts:**

| Code | Purpose |
|------|---------|
| `invoke<string>("greet", { name })` | Calls the Rust `greet` command with `name` argument |
| `<string>` type parameter | TypeScript knows the return type is a string |
| `{ name }` | Passes `name` as the argument (JS camelCase → Rust snake_case) |

### `src-tauri/capabilities/default.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open"
  ]
}
```

This grants the main window basic permissions. Add more as needed (see [Doc 03, Section 4](./03_tauri_setup.md#4-capabilities--permissions-new-in-v2)).

---

## Your First Custom Command

Let's add a command that reads a file and returns its contents.

### Step 1: Add the Rust Command

Edit `src-tauri/src/lib.rs`:

```rust
use std::fs;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_text_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, read_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Step 2: Call from React

```tsx
import { invoke } from "@tauri-apps/api/core";

async function loadFile() {
  try {
    // JS camelCase "filePath" → Rust snake_case "file_path"
    const content = await invoke<string>("read_text_file", {
      filePath: "/Users/you/test.txt",
    });
    console.log("File content:", content);
  } catch (error) {
    console.error("Error:", error);
  }
}
```

### Step 3: Register the command

Make sure `read_text_file` is in the `generate_handler!` macro (already done in Step 1):

```rust
.invoke_handler(tauri::generate_handler![greet, read_text_file])
```

If you forget to register a command, `invoke()` will throw an error: `"command read_text_file not found"`.

---

## Development Workflow

### Running in Dev Mode

```bash
npm run tauri dev
```

This does three things simultaneously:
1. Starts the Vite dev server (`npm run dev`)
2. Compiles the Rust backend
3. Opens the native app window pointing to the dev server

### Hot Module Replacement (HMR)

- **Frontend changes** (React/CSS/TS): Instant reload via Vite HMR — no app restart needed
- **Rust changes** (`src-tauri/src/`): Tauri recompiles and restarts the backend automatically (takes a few seconds)
- **Config changes** (`tauri.conf.json`): Requires manual restart (`Ctrl+C` and re-run)

### DevTools

Open the browser DevTools inside your Tauri app:

| Platform | Shortcut |
|----------|----------|
| macOS | `Cmd + Option + I` |
| Windows/Linux | `Ctrl + Shift + I` |

Or right-click in the app window → "Inspect Element".

### Debug Logging

For Rust panics and backtraces:

```bash
RUST_BACKTRACE=1 npm run tauri dev
```

For Rust `println!` and `eprintln!` output, check the terminal where you ran `tauri dev`.

### Tauri Info

Print useful debug information:

```bash
npx tauri info
```

Shows: OS, architecture, Rust version, Tauri version, WebView version, Node version.

---

## Building for Production

### Create a Release Build

```bash
npm run tauri build
```

This:
1. Runs `npm run build` (creates `dist/`)
2. Compiles Rust in release mode (optimized)
3. Bundles everything into a platform-specific installer

### Build Outputs

| Platform | Output Location | Formats |
|----------|----------------|---------|
| macOS | `src-tauri/target/release/bundle/` | `.app`, `.dmg` |
| Windows | `src-tauri/target/release/bundle/` | `.exe`, `.msi` |
| Linux | `src-tauri/target/release/bundle/` | `.deb`, `.AppImage`, `.rpm` |

### Build for Specific Target

```bash
# macOS: create only .dmg
npm run tauri build -- --bundles dmg

# macOS: create only .app
npm run tauri build -- --bundles app

# Debug build (faster, larger binary)
npm run tauri build -- --debug
```

---

## `.gitignore` Guidance

Make sure these are in your `.gitignore`:

```gitignore
# Node
node_modules/
dist/

# Rust
src-tauri/target/

# Generated files
src-tauri/gen/

# OS files
.DS_Store
Thumbs.db

# Environment files
.env
.env.local
```

The `src-tauri/target/` directory can grow to several GB — **never** commit it.

---

## Troubleshooting

### `tauri dev` hangs or shows blank window

1. Make sure the Vite dev server is running at `http://localhost:5173`
2. Check that `devUrl` in `tauri.conf.json` matches
3. Try restarting: `Ctrl+C` → `npm run tauri dev`

### `error: failed to run custom build command for tauri`

```bash
# Check Tauri system requirements
npx tauri info

# On macOS, ensure Xcode CLI tools are installed
xcode-select --install
```

### `command X not found` error from invoke()

1. Make sure the command is in `generate_handler![]` in `lib.rs`
2. Make sure the command name in `invoke()` matches exactly (use snake_case)
3. Restart `tauri dev` after adding new commands

### `Cannot find module '@tauri-apps/api/core'`

```bash
npm install @tauri-apps/api@latest
```

### Build succeeds but app crashes on launch

```bash
# Run with backtrace for more info
RUST_BACKTRACE=full npm run tauri build -- --debug
# Then run the debug binary directly
./src-tauri/target/debug/my-tauri-app
```

### Slow first compilation

Normal. Rust compiles all dependencies from source on the first build. Add this to `src-tauri/.cargo/config.toml` for faster dev builds on macOS:

```toml
[target.aarch64-apple-darwin]
rustflags = ["-C", "link-arg=-fuse-ld=/usr/bin/ld"]
```

### Permission denied errors when accessing files

Add the necessary permissions to `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "core:default",
    "fs:allow-read",
    "fs:allow-write"
  ]
}
```

See [Doc 03, Capabilities](./03_tauri_setup.md#4-capabilities--permissions-new-in-v2) for details.

---

## Quick Reference: Common npm Scripts

Add these to your `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

---

## What's Next?

You now have a working Tauri v2 app. From here you can:

1. **Add more Rust commands** — see [Doc 03, Commands](./03_tauri_setup.md#6-commands-ipc)
2. **Use events** for real-time communication — see [Doc 03, Events](./03_tauri_setup.md#7-events)
3. **Add plugins** for filesystem, dialogs, notifications — see [Doc 03, Plugins](./03_tauri_setup.md#9-key-cargo-dependencies)
4. **Configure permissions** for security — see [Doc 03, Capabilities](./03_tauri_setup.md#4-capabilities--permissions-new-in-v2)
5. **Build and distribute** your app — see [Building for Production](#building-for-production) above

---

← [03 — Tauri Setup](./03_tauri_setup.md) | **All docs:** [01](./01_react_setup.md) · [02](./02_rust_setup.md) · [03](./03_tauri_setup.md) · [04](./04_create_tauri_app.md)
