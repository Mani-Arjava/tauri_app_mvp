# Agent Creator — CLAUDE.md

## Project Identity
- **App name:** Agent Creator
- **Stack:** Tauri v2 + React 19 + TypeScript + Vite + shadcn/ui + Tailwind CSS
- **Purpose:** Desktop app for creating and running custom Claude agents via ACP

## Folder Structure

```
Tauri_mvp_app/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── components.json
├── index.html
├── src/
│   ├── main.tsx
│   ├── index.css
│   ├── App.tsx
│   ├── lib/
│   │   └── utils.ts
│   ├── types/
│   │   ├── agent.ts
│   │   └── task.ts
│   ├── utils/
│   │   └── id.ts
│   ├── hooks/
│   │   ├── useAgents.ts
│   │   └── useTaskRunner.ts
│   ├── components/
│   │   ├── ui/              (shadcn primitives)
│   │   ├── agents/
│   │   │   ├── AgentList.tsx
│   │   │   ├── AgentCard.tsx
│   │   │   ├── AgentFormDialog.tsx
│   │   │   └── McpServerFields.tsx
│   │   └── tasks/
│   │       ├── TaskRunner.tsx
│   │       └── TaskResultCard.tsx
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── acp/            (ACP bridge — JSON-RPC over stdio)
│   │   └── agents/         (Agent config CRUD — JSON file storage)
│   └── ...
└── docs/
```

### Directory Rules
- `src/types/` — TypeScript interfaces and type definitions only
- `src/utils/` — pure utility functions (no React, no hooks, no side effects)
- `src/hooks/` — custom React hooks only
- `src/lib/` — shared utilities (cn helper)
- `src/components/ui/` — shadcn/ui primitive components (do not modify directly)
- `src/components/agents/` — agent management components
- `src/components/tasks/` — task execution components
- `src-tauri/src/acp/` — Rust ACP bridge (do not modify unless explicitly asked)
- `src-tauri/src/agents/` — Rust agent config storage
- `docs/` — project documentation (do not modify unless explicitly asked)

## Coding Standards

### TypeScript
- Strict mode enabled
- Explicit types on all exports
- No `any` type — use proper types or `unknown`
- Path aliases: `@/*` maps to `./src/*`

### React
- Functional components only
- Named exports (no default exports)
- Props interfaces defined inline or co-located with component

### Styling
- Tailwind CSS via `@tailwindcss/vite` plugin
- shadcn/ui components for all UI primitives
- Use `cn()` from `@/lib/utils` for conditional class merging
- No inline styles except dynamic values (e.g., agent.color)
- CSS variables defined in `src/index.css`

### Dependencies
- shadcn/ui + Radix UI for components
- Tailwind CSS for styling
- lucide-react for icons
- No Redux, Zustand, Context API for state management
- No react-router — state-based view switching with Tabs
- No form libraries — plain `useState`

### Data & Communication
- Agent configs stored as JSON files in Tauri app_data_dir/agents/
- Chat via Rust ACP bridge (JSON-RPC over stdio to Claude)
- System prompt sent silently during task initialization
- ID generation: timestamp + random string (no uuid package)

## Best Practices
- One component per file, one responsibility per component
- Validate at boundaries, trust internal code
- No over-engineering: no abstractions for one-time use
- Handle errors gracefully with user-friendly messages
- Use semantic HTML elements where appropriate
- Keep components focused and props minimal
