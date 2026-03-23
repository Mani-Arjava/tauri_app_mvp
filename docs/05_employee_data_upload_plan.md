# Employee Data Upload & Preview — Tauri v2 MVP

## Complete Project Planning Document

---

## 1. Project Overview

### What We're Building
A **desktop application** using Tauri v2 (React + TypeScript frontend, Rust backend) that allows users to:
- Add employee records with personal/professional details and a photo
- View all employees in a searchable table
- Preview individual employee details
- Edit and delete employee records
- All data persisted locally using browser `localStorage`

### Why This Stack
- **Tauri v2** — lightweight desktop app (~3MB vs Electron's 150MB+)
- **React + TypeScript** — type-safe UI with component reuse
- **Vite** — fast dev server with HMR
- **localStorage** — zero backend complexity, data survives app restarts
- **No API / No database** — pure frontend MVP for learning Tauri concepts

### What This Is NOT
- Not a production app (localStorage has ~5MB limit)
- Not using any external APIs or Rust backend commands for data
- Not a multi-user system (single local user)

---

## 2. Employee Data Model

### 10 Fields + System Fields

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 1 | **Name** | `string` | Yes | Full name |
| 2 | **Employee ID** | `string` | Yes | Company-assigned (e.g., "EMP-001") |
| 3 | **Email** | `string` | Yes | Must contain `@` |
| 4 | **Phone** | `string` | Yes | Any format |
| 5 | **Department** | `string` | Yes | e.g., "Engineering", "HR", "Finance" |
| 6 | **Designation** | `string` | Yes | Job title, e.g., "Senior Developer" |
| 7 | **Date of Birth** | `string` | Yes | Format: `YYYY-MM-DD`, must be in the past |
| 8 | **Date of Joining** | `string` | Yes | Format: `YYYY-MM-DD` |
| 9 | **Address** | `string` | Yes | Full address (single text area) |
| 10 | **Photo** | `string \| null` | No | Base64 data URI or null |

**System-managed fields** (not editable by user):
| Field | Type | Purpose |
|-------|------|---------|
| `id` | `string` | Unique ID, e.g., `"emp_1711234567890_a7b3"` |
| `createdAt` | `string` | ISO timestamp of record creation |
| `updatedAt` | `string` | ISO timestamp of last update |

### TypeScript Interface

```typescript
// src/types/employee.ts

export interface Employee {
  id: string;
  name: string;
  employeeId: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  dateOfBirth: string;       // "YYYY-MM-DD"
  dateOfJoining: string;     // "YYYY-MM-DD"
  address: string;
  photo: string | null;      // Base64 data URI or null
  createdAt: string;         // ISO timestamp
  updatedAt: string;         // ISO timestamp
}

// For the add/edit form (id, createdAt, updatedAt are auto-managed)
export type EmployeeFormData = Omit<Employee, 'id' | 'createdAt' | 'updatedAt'>;
```

---

## 3. App Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Window                       │
│  ┌──────────┐  ┌─────────────────────────────────┐  │
│  │          │  │                                   │  │
│  │ Sidebar  │  │    Content Area                   │  │
│  │          │  │                                   │  │
│  │ - Logo   │  │  One of 4 views:                  │  │
│  │ - Nav    │  │  ┌─────────────────────────────┐  │  │
│  │ - Count  │  │  │ 1. Employee List (table)    │  │  │
│  │ - Storage│  │  │ 2. Employee Detail (read)   │  │  │
│  │          │  │  │ 3. Add Employee (form)      │  │  │
│  │          │  │  │ 4. Edit Employee (form)     │  │  │
│  │          │  │  └─────────────────────────────┘  │  │
│  └──────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
User Action → React Component → useEmployees Hook → storage.ts → localStorage
                    ↑                                      │
                    └──────── re-render with new state ─────┘
```

### Navigation (State-Based, No Router)

```typescript
type AppView =
  | { page: 'list' }
  | { page: 'detail'; employeeId: string }
  | { page: 'add' }
  | { page: 'edit'; employeeId: string };
```

No `react-router` needed — only 4 views, and a desktop app has no URL bar. A simple `useState<AppView>` in `App.tsx` handles all navigation.

### Why No Rust Commands?

| Operation | Browser API Used | Rust Needed? |
|-----------|-----------------|-------------|
| Store/retrieve data | `localStorage` | No |
| Pick image file | `<input type="file">` | No |
| Read image file | `FileReader` | No |
| Compress image | `Canvas` API | No |
| Search/filter | Array `.filter()` | No |

The Rust backend stays at default scaffold. Only `tauri.conf.json` is customized (window size, title, CSP).

---

## 4. Image Upload Strategy

### The Pipeline

```
User clicks upload
    → <input type="file" accept="image/*"> opens native picker
    → File selected
    → Validate: type (JPEG/PNG/WebP) + size (<2MB raw)
    → If invalid → show error message
    → If valid → compress via Canvas:
        - Load into <img> element
        - Draw onto <canvas> at max 400×400 pixels
        - Export as JPEG at 70% quality
        - Result: ~40-110KB base64 string
    → Store base64 string in employee.photo field
    → Show preview in form
```

### Size Budget

| Stage | Size |
|-------|------|
| Original photo (phone camera) | 2-5 MB |
| After resize to 400x400 + JPEG 70% | 30-80 KB |
| After base64 encoding (1.37x overhead) | 40-110 KB |
| Employee text fields | ~0.5 KB |
| **Total per employee** | **~40-110 KB** |
| **localStorage limit** | **~5 MB** |
| **Capacity** | **~45-125 employees** |

This is plenty for an MVP demo.

### Image Utility Functions

```typescript
// src/utils/image.ts

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_MB = 2;
const TARGET_MAX_DIMENSION = 400;
const COMPRESSION_QUALITY = 0.7;

function validateImageFile(file: File): { valid: boolean; error?: string }
function compressAndConvertToBase64(file: File): Promise<string>
```

---

## 5. localStorage Design

### Storage Structure

Single key `"employee_data"` holds a JSON array:

```json
// localStorage.getItem("employee_data") →
[
  {
    "id": "emp_1711234567890_a7b3",
    "name": "Mani Kumar",
    "employeeId": "EMP-001",
    "email": "mani@company.com",
    "phone": "9876543210",
    "department": "Engineering",
    "designation": "Senior Developer",
    "dateOfBirth": "1995-06-15",
    "dateOfJoining": "2022-01-10",
    "address": "123 Main St, Chennai, TN 600001",
    "photo": "data:image/jpeg;base64,/9j/4AAQ...",
    "createdAt": "2026-03-23T10:00:00.000Z",
    "updatedAt": "2026-03-23T10:00:00.000Z"
  }
]
```

### CRUD Functions

```typescript
// src/utils/storage.ts

const STORAGE_KEY = 'employee_data';

getAllEmployees(): Employee[]           // Read + JSON.parse
getEmployeeById(id: string): Employee | undefined
addEmployee(data: EmployeeFormData): Employee    // Generate id + timestamps, push, save
updateEmployee(id: string, data: EmployeeFormData): Employee  // Find, merge, update timestamp
deleteEmployee(id: string): void       // Filter out, save
getStorageUsage(): { usedKB: number; limitKB: number; percentUsed: number }
```

### ID Generator

```typescript
// src/utils/id.ts
export function generateId(): string {
  return `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}
// Output: "emp_1711234567890_a7b3"
```

---

## 6. Component Breakdown

### 6.1 `Layout.tsx` — App Shell

```
┌──────────────────────────────────────────────┐
│ ┌──────────┐ ┌─────────────────────────────┐ │
│ │ EMPLOYEE │ │                             │ │
│ │ MANAGER  │ │   {children} renders here   │ │
│ │          │ │                             │ │
│ │ [All]    │ │                             │ │
│ │ [+ Add ] │ │                             │ │
│ │          │ │                             │ │
│ │ 12 total │ │                             │ │
│ │          │ │                             │ │
│ │ Storage: │ │                             │ │
│ │ ████░ 2MB│ │                             │ │
│ └──────────┘ └─────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Props:** `children`, `totalCount`, `storageUsage`, `onNavigateToList`, `onNavigateToAdd`, `currentPage`

### 6.2 `SearchBar.tsx` — Filter Input

Simple controlled text input at the top of the list view. Filters employees by name, ID, department, or designation as the user types.

**Props:** `value`, `onChange`, `placeholder`

### 6.3 `ImageUpload.tsx` — Photo Upload

Three visual states:
1. **Empty** — Dashed border box with "Click to upload photo" and camera icon
2. **With photo** — Shows preview thumbnail + "Change" and "Remove" buttons
3. **Error** — Shows error message (wrong type, too large)

**Props:** `currentImage: string | null`, `onImageChange: (base64: string | null) => void`

**Internals:** Hidden `<input type="file" accept="image/jpeg,image/png,image/webp">`, triggered by clicking the upload zone.

### 6.4 `EmployeeForm.tsx` — Add/Edit Form

Shared form for both adding and editing. Two-column layout for fields:

```
┌──────────────────────────────────────────┐
│  Add New Employee    /    Edit Employee   │
├──────────────────────────────────────────┤
│                                          │
│  [Photo Upload Component]                │
│                                          │
│  Name: [____________]  Employee ID: [__] │
│  Email: [___________]  Phone: [________] │
│  Department: [______]  Designation: [__] │
│  Date of Birth: [___]  Date of Joining:[]│
│  Address: [_____________________________]│
│           [_____________________________]│
│                                          │
│           [Cancel]  [Save Employee]      │
└──────────────────────────────────────────┘
```

**Props:** `initialData?: EmployeeFormData`, `onSubmit`, `onCancel`, `isEditing: boolean`

**Validation (inline, on submit):**
- All text fields: required, non-empty
- Email: must contain `@`
- Date of Birth: must be in the past
- Show red border + error text below invalid fields

### 6.5 `EmployeeList.tsx` — Table View

```
┌──────────────────────────────────────────────────────────┐
│ [Search: ________________]                               │
├──────┬───────────┬────────┬────────────┬──────────┬──────┤
│ Photo│ Name      │ Emp ID │ Department │ Desig.   │ Acts │
├──────┼───────────┼────────┼────────────┼──────────┼──────┤
│      │ Mani K    │ EMP-001│ Engineering│ Sr Dev   │      │
│      │ Priya S   │ EMP-002│ HR         │ Manager  │      │
│      │ Raj P     │ EMP-003│ Finance    │ Analyst  │      │
└──────┴───────────┴────────┴────────────┴──────────┴──────┘
  Showing 3 of 3 employees

  [Empty state: "No employees found. Click 'Add Employee' to get started."]
```

**Props:** `employees`, `onView(id)`, `onEdit(id)`, `onDelete(id)`

- Clicking a row navigates to detail view
- Edit/Delete buttons on each row
- Photo column shows 40x40 thumbnail or placeholder avatar
- Hoverable rows with subtle highlight

### 6.6 `EmployeeDetail.tsx` — Detail View

```
┌──────────────────────────────────────────┐
│  ← Back to List                          │
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────┐  Name: Mani Kumar          │
│  │          │  Employee ID: EMP-001      │
│  │  Photo   │  Email: mani@company.com   │
│  │ (200x200)│  Phone: 9876543210         │
│  │          │  Department: Engineering   │
│  └──────────┘  Designation: Sr Developer │
│                                          │
│  Date of Birth: June 15, 1995            │
│  Date of Joining: January 10, 2022       │
│  Address: 123 Main St, Chennai, TN       │
│                                          │
│  Created: Mar 23, 2026                   │
│  Last Updated: Mar 23, 2026              │
│                                          │
│           [Edit]  [Delete]               │
└──────────────────────────────────────────┘
```

**Props:** `employee`, `onEdit`, `onDelete`, `onBack`

### 6.7 `DeleteConfirmDialog.tsx` — Confirmation Modal

```
┌─────────────────────────────────┐
│  Confirm Delete                  │
│                                  │
│  Are you sure you want to delete │
│  employee "Mani Kumar"?          │
│  This action cannot be undone.   │
│                                  │
│       [Cancel]  [Delete]         │
└─────────────────────────────────┘
```

**Props:** `employeeName`, `onConfirm`, `onCancel`, `isOpen`

Modal overlay with dark backdrop. Triggered from list or detail view.

---

## 7. Custom Hook: `useEmployees`

```typescript
// src/hooks/useEmployees.ts

function useEmployees() {
  // State
  const [employees, setEmployees] = useState<Employee[]>(() => storage.getAllEmployees());
  const [searchTerm, setSearchTerm] = useState('');

  // After every mutation, re-read from localStorage into state
  const refresh = () => setEmployees(storage.getAllEmployees());

  // CRUD — delegates to storage utils, then refreshes state
  const addEmployee = (data: EmployeeFormData) => { storage.addEmployee(data); refresh(); };
  const updateEmployee = (id, data) => { storage.updateEmployee(id, data); refresh(); };
  const deleteEmployee = (id) => { storage.deleteEmployee(id); refresh(); };
  const getById = (id) => storage.getEmployeeById(id);

  // Filtered list
  const filteredEmployees = employees.filter(emp => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return emp.name.toLowerCase().includes(term)
        || emp.employeeId.toLowerCase().includes(term)
        || emp.department.toLowerCase().includes(term)
        || emp.designation.toLowerCase().includes(term);
  });

  return {
    employees: filteredEmployees,
    totalCount: employees.length,
    searchTerm, setSearchTerm,
    addEmployee, updateEmployee, deleteEmployee, getById,
    storageUsage: storage.getStorageUsage(),
  };
}
```

Called once in `App.tsx`, passed down as props to child components.

---

## 8. App.tsx — Root Wiring

```typescript
function App() {
  const [view, setView] = useState<AppView>({ page: 'list' });
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const empState = useEmployees();

  // Navigation helpers
  const nav = {
    toList: () => setView({ page: 'list' }),
    toDetail: (id: string) => setView({ page: 'detail', employeeId: id }),
    toAdd: () => setView({ page: 'add' }),
    toEdit: (id: string) => setView({ page: 'edit', employeeId: id }),
  };

  // Render active view based on state
  let content: JSX.Element;
  switch (view.page) {
    case 'list':    content = <EmployeeList ... />; break;
    case 'detail':  content = <EmployeeDetail ... />; break;
    case 'add':     content = <EmployeeForm isEditing={false} ... />; break;
    case 'edit':    content = <EmployeeForm isEditing={true} initialData={...} ... />; break;
  }

  return (
    <Layout currentPage={view.page} ... >
      {content}
      {deleteTarget && <DeleteConfirmDialog ... />}
    </Layout>
  );
}
```

---

## 9. File Tree

```
Tauri_mvp_app/
├── docs/                           # Existing — unchanged
│   ├── 01_react_setup.md
│   ├── 02_rust_setup.md
│   ├── 03_tauri_setup.md
│   ├── 04_create_tauri_app.md
│   └── tauri_v1_official_guide_analysis.md
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
│
├── public/
│   └── placeholder-avatar.svg      # Default avatar for employees without photos
│
├── src/
│   ├── main.tsx                    # ReactDOM.createRoot
│   ├── App.tsx                     # Root: navigation state + hook + layout
│   ├── App.css                     # Global styles + CSS variables
│   │
│   ├── types/
│   │   └── employee.ts             # Employee interface, EmployeeFormData type
│   │
│   ├── utils/
│   │   ├── id.ts                   # generateId() function
│   │   ├── storage.ts              # localStorage CRUD helpers
│   │   └── image.ts                # Image validation, compression, base64 conversion
│   │
│   ├── hooks/
│   │   └── useEmployees.ts         # Custom hook: state + localStorage sync + search
│   │
│   ├── components/
│   │   ├── Layout.tsx              # App shell: sidebar + content area
│   │   ├── SearchBar.tsx           # Filter input
│   │   ├── ImageUpload.tsx         # Photo upload with compression + preview
│   │   ├── EmployeeForm.tsx        # Add/Edit form with validation
│   │   ├── EmployeeList.tsx        # Table view of all employees
│   │   ├── EmployeeDetail.tsx      # Full detail view of one employee
│   │   └── DeleteConfirmDialog.tsx # Confirmation modal
│   │
│   └── styles/
│       └── components.css          # Component-specific styles
│
└── src-tauri/                      # Tauri v2 scaffold — minimal changes
    ├── Cargo.toml
    ├── tauri.conf.json             # Customize: title, size, CSP, identifier
    ├── build.rs
    ├── icons/
    ├── capabilities/
    │   └── default.json            # core:default + shell:allow-open
    └── src/
        ├── lib.rs                  # Default scaffold (greet command)
        └── main.rs                 # Default scaffold (calls lib::run)
```

---

## 10. Tauri Configuration Changes

### `tauri.conf.json` (only differences from default scaffold)

```jsonc
{
  "identifier": "com.learning.employee-manager",
  "productName": "Employee Data Manager",
  "version": "0.1.0",
  "app": {
    "windows": [
      {
        "title": "Employee Data Manager",
        "width": 1200,
        "height": 800,
        "resizable": true
      }
    ],
    "security": {
      // Add "data:" to img-src for base64 images
      "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost data:; connect-src ipc: http://ipc.localhost"
    }
  }
}
```

No custom Rust commands. No additional plugins. No additional capabilities.

---

## 11. Styling Approach

### CSS Variables (defined in `App.css`)

```css
:root {
  --color-primary: #2563eb;       /* Blue — buttons, links, active states */
  --color-primary-hover: #1d4ed8;
  --color-danger: #dc2626;        /* Red — delete buttons */
  --color-bg-sidebar: #f1f5f9;    /* Light gray sidebar */
  --color-bg-content: #ffffff;    /* White content area */
  --color-bg-hover: #f8fafc;     /* Table row hover */
  --color-border: #e2e8f0;       /* Borders, dividers */
  --color-text: #1e293b;         /* Primary text */
  --color-text-muted: #64748b;   /* Secondary text */
  --sidebar-width: 220px;
}
```

### Key Styling Rules
- Sidebar: fixed left, 220px, light gray bg, full height
- Content area: remaining width, white bg, scrollable
- Table: full width, alternating row colors optional, hover highlight
- Form: two-column grid for fields, single column on narrow views
- Buttons: rounded, colored (blue for primary, red for delete, gray for cancel)
- Image upload zone: dashed border, 150x150, centered placeholder text
- Modal: centered, white card, dark semi-transparent backdrop
- Storage bar: thin progress bar in sidebar with percentage text

---

## 12. Implementation Order

### Phase 1 — Scaffolding
1. Scaffold Tauri v2 app into the project directory
2. Install dependencies, verify `npm run tauri dev` works
3. Update `tauri.conf.json` (title, size, identifier, CSP)
4. Clean out default starter UI from `App.tsx`

### Phase 2 — Data Layer
5. Create `src/types/employee.ts` (interface + types)
6. Create `src/utils/id.ts` (ID generator)
7. Create `src/utils/storage.ts` (localStorage CRUD)
8. Create `src/utils/image.ts` (validation + compression)

### Phase 3 — State Hook
9. Create `src/hooks/useEmployees.ts` (state + storage sync + search)

### Phase 4 — UI Components (order matters — dependencies first)
10. Create `Layout.tsx` (app shell — needed by everything)
11. Create `SearchBar.tsx` (simple, standalone)
12. Create `ImageUpload.tsx` (needed by form)
13. Create `EmployeeForm.tsx` (uses ImageUpload)
14. Create `EmployeeList.tsx` (uses SearchBar)
15. Create `EmployeeDetail.tsx` (standalone read view)
16. Create `DeleteConfirmDialog.tsx` (modal)

### Phase 5 — Integration
17. Wire everything in `App.tsx` (navigation, hook, component rendering)
18. Add `placeholder-avatar.svg` to `public/`

### Phase 6 — Styling
19. Write `App.css` (global styles, CSS variables, layout)
20. Write `styles/components.css` (component-specific styles)

### Phase 7 — Edge Cases & Polish
21. Handle `QuotaExceededError` (show user-friendly message)
22. Empty states (no employees, no search results)
23. Storage usage indicator in sidebar
24. Form reset after successful submit
25. Confirm navigation away from unsaved form (optional)

---

## 13. Design Decisions Summary

| Decision | Choice | Why |
|----------|--------|-----|
| Data storage | `localStorage` (single JSON array) | User requested, simplest, no Rust needed |
| Navigation | `useState<AppView>` | 4 views, no URL bar in desktop app, zero deps |
| Image handling | Canvas compress -> base64 -> localStorage | Browser-native, no plugins/packages needed |
| File picker | HTML `<input type="file">` | Works in Tauri WebView, simpler than Tauri dialog plugin |
| Form library | None (plain `useState`) | Single form, simple validation |
| CSS framework | None (plain CSS + variables) | Zero dependencies, full control |
| Routing library | None | State-based, 4 views only |
| ID generation | Timestamp + random string | No `uuid` dependency needed |
| Rust backend | Default scaffold, no changes | No system-level operations required |
| Extra npm packages | **Zero** | Everything built with React + browser APIs |

---

## 14. Future Enhancements (Not in MVP)

These are noted for context but will NOT be built in the MVP:

- **Export to CSV** — would need Rust `fs` commands
- **Import from CSV** — would need Tauri dialog plugin + Rust parsing
- **SQLite storage** — replace localStorage when data grows beyond demo size
- **Bulk upload** — upload multiple employees from a spreadsheet
- **Department dropdown** — pre-populated list instead of free text
- **Dark mode** — CSS variable swap
- **Print employee card** — browser print API
- **Data backup/restore** — export/import JSON file via Tauri fs plugin

---

## 15. Verification Checklist

After implementation, test these scenarios:

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | `npm run tauri dev` | App opens, 1200x800, titled "Employee Data Manager" |
| 2 | Add employee with photo | Appears in list with thumbnail |
| 3 | Add employee without photo | Placeholder avatar shows in list and detail |
| 4 | View employee detail | All 10 fields displayed correctly |
| 5 | Edit employee | Changes persist, `updatedAt` timestamp changes |
| 6 | Delete employee | Confirmation dialog -> removed from list |
| 7 | Search by name | List filters in real time |
| 8 | Search by department | List filters in real time |
| 9 | Upload >2MB image | Error message: "Image must be smaller than 2MB" |
| 10 | Upload .txt file | Error message: "Only JPEG, PNG, and WebP allowed" |
| 11 | Close and reopen app | All data persists (localStorage survives restart) |
| 12 | Add 15+ employees | Storage indicator updates, app remains responsive |
| 13 | Delete all employees | Empty state message shown in list |
| 14 | Submit form with empty required fields | Inline validation errors shown |
