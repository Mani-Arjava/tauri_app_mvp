# Employee Data Manager

A desktop employee data manager built with **Tauri v2 + React 19 + TypeScript + Vite**. Add, view, edit, and delete employee records with photo upload, all persisted in localStorage.

---

## Step-by-Step: How This App Was Built

### Step 1 — Project Scaffolding

Initialize the project with Vite and install dependencies.

```bash
npm create vite@latest Tauri_mvp_app -- --template react-ts
cd Tauri_mvp_app
npm install
npm install @tauri-apps/api@^2.0.0
npm install -D @tauri-apps/cli@^2.0.0
```

This gives you:
- `package.json` — project config with React 19, Vite 6, TypeScript 5
- `tsconfig.json` — strict TypeScript with `react-jsx` transform
- `vite.config.ts` — Vite dev server on port 1420 (Tauri's default)
- `index.html` — single HTML entry point with `<div id="root">`

### Step 2 — Define the Data Types

**File:** `src/types/employee.ts`

Before writing any UI, define what an employee looks like and how navigation works.

```typescript
// The full employee record stored in localStorage
export interface Employee {
  id: string;
  name: string;
  employeeId: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  dateOfBirth: string;
  dateOfJoining: string;
  address: string;
  photo: string | null;       // base64 data URI or null
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
}

// What the form works with (no id/timestamps — those are generated)
export type EmployeeFormData = Omit<Employee, "id" | "createdAt" | "updatedAt">;

// State-based navigation — no react-router needed
export type AppView =
  | { page: "list" }
  | { page: "detail"; employeeId: string }
  | { page: "add" }
  | { page: "edit"; employeeId: string };
```

**Key decisions:**
- `AppView` is a discriminated union — each page knows what data it needs
- `EmployeeFormData` strips out auto-generated fields so forms stay clean
- Photos are stored as base64 strings right in localStorage

### Step 3 — Build Utility Functions

Three small, pure utility files with zero React dependencies.

#### 3a. ID Generator — `src/utils/id.ts`

```typescript
export function generateId(): string {
  return `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}
```

Generates IDs like `emp_1711234567890_x7k2`. No uuid package needed.

#### 3b. localStorage CRUD — `src/utils/storage.ts`

```typescript
const STORAGE_KEY = "employee_data";

// Internal helper — writes to localStorage with quota error handling
function saveToStorage(employees: Employee[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(employees));
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      throw new Error("Storage is full. Please delete some employees or remove photos to free up space.");
    }
    throw e;
  }
}

// Public CRUD functions
export function getAllEmployees(): Employee[] { ... }
export function getEmployeeById(id: string): Employee | undefined { ... }
export function addEmployee(data: EmployeeFormData): Employee { ... }
export function updateEmployee(id: string, data: EmployeeFormData): Employee { ... }
export function deleteEmployee(id: string): void { ... }
export function getStorageUsage(): { usedKB, limitKB, percentUsed } { ... }
```

**Pattern:** All functions read/write through `localStorage.getItem`/`setItem` with the single key `"employee_data"`. The `saveToStorage` wrapper catches `QuotaExceededError` so the UI can show a friendly message.

#### 3c. Image Utilities — `src/utils/image.ts`

```typescript
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  // Allows JPEG, PNG, WebP — max 2MB
}

export function compressAndConvertToBase64(file: File): Promise<string> {
  // 1. FileReader reads the file
  // 2. Image element loads the data
  // 3. Canvas resizes to max 400x400 (preserving aspect ratio)
  // 4. canvas.toDataURL("image/jpeg", 0.7) compresses to ~70% quality
  // 5. Returns base64 string
}
```

**Why Canvas API?** No npm packages needed. The browser handles resizing and compression natively.

### Step 4 — Create the State Hook

**File:** `src/hooks/useEmployees.ts`

One hook manages all employee state, search, and error handling.

```typescript
export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>(() => storage.getAllEmployees());
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Wraps storage calls with error handling
  const addEmployee = (data) => { try { storage.addEmployee(data); refresh(); } catch ... };
  const updateEmployee = (id, data) => { ... };
  const deleteEmployee = (id) => { ... };

  // Search filtering with useMemo
  const filteredEmployees = useMemo(() => {
    if (!searchTerm) return employees;
    return employees.filter(emp =>
      emp.name.toLowerCase().includes(term) ||
      emp.employeeId.toLowerCase().includes(term) ||
      emp.department.toLowerCase().includes(term) ||
      emp.designation.toLowerCase().includes(term)
    );
  }, [employees, searchTerm]);

  return { employees: filteredEmployees, totalCount, searchTerm, setSearchTerm,
           addEmployee, updateEmployee, deleteEmployee, getById, storageUsage, error, clearError };
}
```

**Pattern:** The hook reads from localStorage on mount, and re-reads (`refresh()`) after every mutation. Search is derived state via `useMemo`.

### Step 5 — Build the UI Components (bottom-up)

Build small, reusable pieces first, then compose them.

#### 5a. SearchBar — `src/components/SearchBar.tsx`

A controlled text input with a clear button. Searches by name, ID, department, or designation.

#### 5b. ImageUpload — `src/components/ImageUpload.tsx`

- Hidden `<input type="file">` triggered by a button click
- Validates the file (type + size) via `validateImageFile()`
- Compresses via `compressAndConvertToBase64()`
- Shows preview with Change/Remove actions when a photo exists

#### 5c. EmployeeForm — `src/components/EmployeeForm.tsx`

- Works for both Add and Edit (controlled by `isEditing` prop)
- Uses `useState` for form state — no form libraries
- Validates all fields on submit (name, email with @, dates, etc.)
- Includes `ImageUpload` for the photo field
- Two-column grid layout with `form-grid` CSS class

#### 5d. EmployeeList — `src/components/EmployeeList.tsx`

- Shows an empty state when no employees exist
- Renders a `<table>` with photo, name, emp ID, department, designation, actions
- Each row is clickable (navigates to detail view)
- Edit/Delete buttons stop event propagation so they don't trigger row click
- Shows "Showing X of Y employees" when search is active

#### 5e. EmployeeDetail — `src/components/EmployeeDetail.tsx`

- Displays full employee info with photo
- Back button, Edit button, Delete button
- Shows created/updated timestamps
- Formats dates with `toLocaleDateString("en-US", ...)`

#### 5f. DeleteConfirmDialog — `src/components/DeleteConfirmDialog.tsx`

- Modal overlay that appears when `isOpen` is true
- Clicking the overlay cancels; clicking the modal content doesn't propagate
- Shows the employee name and a warning that deletion can't be undone

#### 5g. Layout — `src/components/Layout.tsx`

- Sidebar + main content layout
- Sidebar has: app title, nav buttons (All Employees, + Add Employee), employee count, storage usage bar
- Active page is highlighted in the nav
- Storage bar shows `usedKB / limitKB (percentUsed%)`

### Step 6 — Wire Everything in App.tsx

**File:** `src/App.tsx`

The root component connects navigation, state, and views.

```typescript
export function App() {
  const [view, setView] = useState<AppView>({ page: "list" });
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const empState = useEmployees();

  // Navigation helpers
  const nav = {
    toList: () => setView({ page: "list" }),
    toDetail: (id) => setView({ page: "detail", employeeId: id }),
    toAdd: () => setView({ page: "add" }),
    toEdit: (id) => setView({ page: "edit", employeeId: id }),
  };

  // switch(view.page) renders the correct component
  // Layout wraps everything with sidebar
  // DeleteConfirmDialog is always mounted, shown/hidden via isOpen
  // Error banner shows at top when empState.error exists
}
```

**Navigation pattern:** No router — just `useState<AppView>`. The `switch` statement renders the right component. This is simpler than react-router for a single-window desktop app.

### Step 7 — Entry Point

**File:** `src/main.tsx`

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./App.css";
import "./styles/components.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Two CSS files imported here:
- `App.css` — CSS variables, global layout, reset styles
- `styles/components.css` — all component-specific styles

### Step 8 — Styling

**File:** `src/App.css` — CSS variables and layout

```css
:root {
  --primary: #4f46e5;
  --danger: #dc2626;
  --bg: #f8fafc;
  --sidebar-bg: #1e293b;
  /* ... more variables */
}
```

**File:** `src/styles/components.css` — component styles

All styles use plain CSS with the variables from App.css. No Tailwind, no CSS-in-JS.

### Step 9 — Tauri Backend

**Directory:** `src-tauri/`

The Rust backend was scaffolded separately. For frontend development, you can run just `npm run dev` (Vite only). For the full desktop app, run `npm run tauri dev`.

---

## Project Structure

```
src/
  main.tsx                  ← Entry point
  App.tsx                   ← Root component (navigation + layout)
  App.css                   ← CSS variables + global styles
  types/
    employee.ts             ← Employee, EmployeeFormData, AppView types
  utils/
    id.ts                   ← ID generation (timestamp + random)
    storage.ts              ← localStorage CRUD operations
    image.ts                ← Image validation + Canvas compression
  hooks/
    useEmployees.ts         ← All employee state + search + errors
  components/
    Layout.tsx              ← Sidebar + content shell
    SearchBar.tsx            ← Search input with clear button
    ImageUpload.tsx          ← Photo upload with preview
    EmployeeForm.tsx         ← Add/Edit form with validation
    EmployeeList.tsx         ← Table view with search
    EmployeeDetail.tsx       ← Single employee view
    DeleteConfirmDialog.tsx  ← Confirmation modal
  styles/
    components.css           ← Component-specific styles
```

## Data Flow

```
User Action → Component → useEmployees hook → storage.ts → localStorage
                                    ↓
                              useState refresh
                                    ↓
                          Re-render with new data
```

## Running the App

```bash
# Frontend only (browser)
npm run dev

# Full desktop app (Tauri + Rust + frontend)
npm run tauri dev

# Type check
npx tsc --noEmit

# Build frontend
npx vite build
```
