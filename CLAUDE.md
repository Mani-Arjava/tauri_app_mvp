# Employee Data Manager — CLAUDE.md

## Project Identity
- **App name:** Employee Data Manager
- **Stack:** Tauri v2 + React 19 + TypeScript + Vite
- **Purpose:** Desktop employee data manager MVP — add, view, edit, delete employee records with photo upload, all persisted in localStorage

## Folder Structure

```
Tauri_mvp_app/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   └── placeholder-avatar.svg
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── App.css
│   ├── types/
│   │   └── employee.ts
│   ├── utils/
│   │   ├── id.ts
│   │   ├── storage.ts
│   │   └── image.ts
│   ├── hooks/
│   │   └── useEmployees.ts
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── SearchBar.tsx
│   │   ├── ImageUpload.tsx
│   │   ├── EmployeeForm.tsx
│   │   ├── EmployeeList.tsx
│   │   ├── EmployeeDetail.tsx
│   │   └── DeleteConfirmDialog.tsx
│   └── styles/
│       └── components.css
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
- Variables defined in `src/App.css`, component styles in `src/styles/components.css`

### Dependencies
- Zero npm packages beyond React + Tauri API + Vite tooling
- No Redux, Zustand, Context API for state management
- No react-router — navigation is state-based (`AppView` union type)
- No form libraries — plain `useState`

### Data & Storage
- `localStorage` only, single key `"employee_data"`
- Image handling: browser Canvas API for compression, base64 data URIs
- ID generation: timestamp + random string (no uuid package)

## Best Practices
- One component per file, one responsibility per component
- Validate at boundaries (form submission, file upload), trust internal code
- No over-engineering: no abstractions for one-time use, no premature optimization
- Handle errors gracefully with user-friendly messages
- Use semantic HTML elements where appropriate
- Keep components focused and props minimal

## Planning Doc Reference
- Full technical spec: `docs/05_employee_data_upload_plan.md`
