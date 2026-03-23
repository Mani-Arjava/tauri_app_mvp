# 01 — React + Vite Setup for Tauri

## Why React + Vite for Tauri?

Tauri requires a **static frontend build** — it serves compiled HTML/CSS/JS through a native WebView, not a live server. Vite is the **officially recommended** bundler by Tauri because:

- Blazing fast HMR during development
- Outputs static files (`dist/`) that Tauri embeds into the binary
- First-class React + TypeScript support
- Minimal config required

> **Note:** Tauri is frontend-agnostic. You could use Next.js (static export), Svelte, Vue, etc. We choose React + Vite because it's the most common pairing and officially supported.

---

## 1. Install Node.js via nvm

### macOS (Primary)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Restart terminal or source profile
source ~/.zshrc

# Install latest LTS Node.js
nvm install --lts
nvm use --lts

# Verify
node --version   # v20.x or v22.x
npm --version    # 10.x+
```

### Windows

Use [nvm-windows](https://github.com/coreybutler/nvm-windows) or install Node.js directly from [nodejs.org](https://nodejs.org).

### Linux

Same `nvm` install script as macOS, but source `~/.bashrc` instead of `~/.zshrc`.

---

## 2. Create a Vite + React-TS Project

```bash
# Navigate to your projects directory
cd ~/Projects/Learning

# Create a new Vite project with React + TypeScript
npm create vite@latest my-tauri-app -- --template react-ts

cd my-tauri-app
npm install
```

This generates:

```
my-tauri-app/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── App.css
└── public/
```

---

## 3. Tauri-Specific Vite Configuration

Edit `vite.config.ts` to work properly with Tauri:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  // Prevent Vite from clearing the terminal so you can see Rust logs
  clearScreen: false,

  server: {
    // Tauri expects a fixed port; fail if it's taken
    port: 5173,
    strictPort: true,

    // Allow Tauri's asset protocol for loading files
    host: "localhost",

    // Watch for file changes but ignore the Rust backend
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

### Why These Settings Matter

| Setting | Reason |
|---------|--------|
| `clearScreen: false` | Keeps Rust compiler output visible in the same terminal |
| `strictPort: true` | Tauri's `devUrl` points to `http://localhost:5173` — if that port is taken, fail early instead of silently using another |
| `watch.ignored` | Prevents Vite from reloading when Rust files change (Tauri handles Rust recompilation separately) |

---

## 4. Key npm Packages for Tauri

```bash
# Tauri CLI — runs Tauri commands (dev, build, init, etc.)
npm install -D @tauri-apps/cli@latest

# Tauri JS API — call Rust commands, listen to events, access native APIs
npm install @tauri-apps/api@latest
```

### What Each Package Does

**`@tauri-apps/cli`** (dev dependency)
- Provides `npx tauri dev`, `npx tauri build`, `npx tauri init`, etc.
- Manages the Rust build pipeline behind the scenes

**`@tauri-apps/api`** (runtime dependency)
- `invoke()` from `@tauri-apps/api/core` — call Rust commands
- `listen()`, `emit()` from `@tauri-apps/api/event` — event system
- Plugin APIs (filesystem, dialog, shell, etc.)

> **Tauri v2 import path:** Use `@tauri-apps/api/core`, NOT `@tauri-apps/api/tauri` (that was v1).

---

## 5. Add Tauri Scripts to package.json

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  }
}
```

Now you can run:

```bash
npm run tauri dev    # Start Tauri in dev mode (frontend + backend)
npm run tauri build  # Create production binary
```

---

## 6. Verify the Dev Server

Before integrating Tauri, confirm the frontend works standalone:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. You should see the Vite + React starter page.

Press `Ctrl+C` to stop when done.

---

## Troubleshooting

### `npm create vite@latest` fails

```bash
# Clear npm cache
npm cache clean --force

# Try with a specific npm version
npm install -g npm@latest
```

### Port 5173 already in use

```bash
# Find what's using the port
lsof -i :5173

# Kill the process
kill -9 <PID>
```

### `nvm: command not found` after install

```bash
# Add to ~/.zshrc if not already there
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

source ~/.zshrc
```

### TypeScript errors on fresh project

```bash
# Make sure all deps are installed
rm -rf node_modules package-lock.json
npm install
```

---

**Next:** [02 — Rust Setup](./02_rust_setup.md) →
