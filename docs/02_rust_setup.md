# 02 — Rust Toolchain Setup for Tauri

## Why Rust?

Tauri's backend is **100% Rust**. Every Tauri app has a Rust process that:

- Creates and manages the native window
- Runs your backend commands (file I/O, APIs, system access)
- Communicates with the frontend via IPC (inter-process communication)
- Compiles to a small, fast native binary (~600KB base)

You don't need to be a Rust expert — Tauri provides macros and abstractions that keep most Rust code simple. But you **must** have the Rust toolchain installed.

---

## 1. macOS Setup (Primary)

### Step 1: Install Xcode Command Line Tools

Rust (and Tauri) need a C compiler and linker:

```bash
xcode-select --install
```

A dialog will pop up — click "Install" and wait for it to finish.

Verify:

```bash
xcode-select -p
# /Library/Developer/CommandLineTools
```

### Step 2: Install Rust via rustup

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

When prompted, choose **option 1** (default installation).

Then load Rust into your current shell:

```bash
source "$HOME/.cargo/env"
```

This also adds `~/.cargo/bin` to your PATH permanently via `~/.zshrc`.

### Step 3: Verify

```bash
rustc --version    # rustc 1.XX.0
cargo --version    # cargo 1.XX.0
rustup --version   # rustup 1.XX.0
```

---

## 2. Windows Setup

### Step 1: Visual Studio C++ Build Tools

Download and install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

During installation, select:
- **"Desktop development with C++"** workload
- Windows 10/11 SDK (auto-selected)

### Step 2: WebView2

Windows 10 (older builds) may need [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). Windows 11 includes it by default.

### Step 3: Install Rust

Download and run [rustup-init.exe](https://rustup.rs). Choose the default MSVC toolchain.

---

## 3. Linux Setup

### Step 1: System Dependencies

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel
sudo dnf group install "C Development Tools and Libraries"
```

### Step 2: Install Rust

Same as macOS:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

---

## 4. Keep Rust Updated

Rust releases every 6 weeks. Keep your toolchain current:

```bash
# Update Rust compiler and tools
rustup update

# Check which toolchains are installed
rustup show

# Update rustup itself
rustup self update
```

---

## 5. Rust Concepts for Tauri Developers

You don't need to learn all of Rust, but these concepts come up frequently in Tauri development:

### Cargo.toml

The Rust equivalent of `package.json`. Located at `src-tauri/Cargo.toml`:

```toml
[package]
name = "my-tauri-app"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "lib"]
```

### lib.rs — Where Your Commands Live

```rust
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### main.rs — Desktop Entry Point

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run()
}
```

> **Why two files?** Tauri v2 supports mobile. `lib.rs` contains your app logic and is shared by desktop (`main.rs`) and mobile entry points.

### Key Rust Patterns in Tauri

| Pattern | What It Means |
|---------|--------------|
| `#[tauri::command]` | Macro that makes a Rust function callable from JavaScript |
| `&str` vs `String` | `&str` = borrowed string (read-only), `String` = owned string (can be modified) |
| `Result<T, E>` | Function returns either success (`Ok(T)`) or error (`Err(E)`) |
| `serde::Serialize` | Allows a Rust struct to be converted to JSON for the frontend |
| `serde::Deserialize` | Allows JSON from the frontend to be parsed into a Rust struct |
| `tauri::State<T>` | Access shared app state in commands |

### The `#[tauri::command]` Macro

```rust
// Arguments: camelCase in JS → snake_case in Rust (automatic conversion)
#[tauri::command]
fn calculate_sum(first_number: i32, second_number: i32) -> i32 {
    first_number + second_number
}
```

Called from JavaScript:

```ts
import { invoke } from "@tauri-apps/api/core";

// JS camelCase → Rust snake_case automatically
const result = await invoke<number>("calculate_sum", {
  firstNumber: 5,
  secondNumber: 3,
});
```

---

## 6. Mobile Targets (Optional)

Tauri v2 supports Android and iOS. To add mobile compilation targets:

```bash
# Android
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# iOS
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
```

You'll also need Android Studio (for Android) or Xcode (for iOS). See [Tauri Mobile Guide](https://tauri.app/start/prerequisites/#mobile) for full setup.

---

## Troubleshooting

### `rustc: command not found`

```bash
# Reload your shell config
source "$HOME/.cargo/env"

# Or restart your terminal
```

### Compilation errors with missing system libs (macOS)

```bash
# Reinstall Xcode CLI tools
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

### `linker 'cc' not found` (Linux)

```bash
sudo apt install build-essential
```

### Slow first compilation

The first `cargo build` downloads and compiles all dependencies. This is normal and can take 2–5 minutes. Subsequent builds are much faster (incremental compilation).

### `error[E0433]: failed to resolve: use of undeclared crate`

```bash
# Make sure you're in the src-tauri directory
cd src-tauri
cargo check
```

Check that the crate is listed in `src-tauri/Cargo.toml` under `[dependencies]`.

---

← [01 — React Setup](./01_react_setup.md) | **Next:** [03 — Tauri Setup](./03_tauri_setup.md) →
