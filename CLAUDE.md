# Weather Chatbot — CLAUDE.md

## Project Identity
- **App name:** Weather Chatbot
- **Stack:** Tauri v2 + React 19 + TypeScript + Vite
- **Purpose:** Desktop weather chatbot powered by Claude via Rust ACP bridge

## Folder Structure

```
Tauri_mvp_app/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── App.css
│   ├── types/
│   │   └── chat.ts
│   ├── utils/
│   │   └── id.ts
│   ├── hooks/
│   │   └── useChat.ts
│   ├── components/
│   │   ├── ChatPanel.tsx
│   │   └── ChatMessage.tsx
│   └── styles/
│       └── chat.css
├── src-tauri/          # Rust backend — do not modify unless explicitly asked
└── docs/               # Documentation — do not modify unless explicitly asked
```

### Directory Rules
- `src/types/` — TypeScript interfaces and type definitions only
- `src/utils/` — pure utility functions (no React, no hooks, no side effects)
- `src/hooks/` — custom React hooks only
- `src/components/` — React components (`.tsx` files)
- `src/styles/` — CSS files
- `src-tauri/` — Rust backend (do not modify unless explicitly asked)
- `docs/` — project documentation (do not modify unless explicitly asked)

## Coding Standards

### TypeScript
- Strict mode enabled
- Explicit types on all exports
- No `any` type — use proper types or `unknown`

### React
- Functional components only
- Named exports (no default exports)
- Props interfaces defined inline or co-located with component

### CSS
- Plain CSS with CSS variables
- No CSS-in-JS, no Tailwind, no CSS frameworks
- Variables defined in `src/App.css`, component styles in `src/styles/chat.css`

### Dependencies
- Zero npm packages beyond React + Tauri API + Vite tooling
- No Redux, Zustand, Context API for state management
- No react-router — single-view app
- No form libraries — plain `useState`

### Data & Communication
- Chat via Rust ACP bridge (JSON-RPC over stdio to Claude)
- System prompt sent silently during initialization
- ID generation: timestamp + random string (no uuid package)

## Best Practices
- One component per file, one responsibility per component
- Validate at boundaries, trust internal code
- No over-engineering: no abstractions for one-time use
- Handle errors gracefully with user-friendly messages
- Use semantic HTML elements where appropriate
- Keep components focused and props minimal

## Planning Doc Reference
- Full technical spec: `docs/05_employee_data_upload_plan.md`
