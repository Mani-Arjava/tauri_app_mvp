import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
  totalCount: number;
  storageUsage: { usedKB: number; limitKB: number; percentUsed: number };
  onNavigateToList: () => void;
  onNavigateToAdd: () => void;
  currentPage: string;
}

export function Layout({
  children,
  totalCount,
  storageUsage,
  onNavigateToList,
  onNavigateToAdd,
  currentPage,
}: LayoutProps) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">Employee Manager</h1>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`sidebar-btn ${currentPage === "list" ? "active" : ""}`}
            onClick={onNavigateToList}
          >
            All Employees
          </button>
          <button
            className={`sidebar-btn sidebar-btn-add ${currentPage === "add" ? "active" : ""}`}
            onClick={onNavigateToAdd}
          >
            + Add Employee
          </button>
        </nav>

        <div className="sidebar-stats">
          <p className="stat-count">{totalCount} employee{totalCount !== 1 ? "s" : ""}</p>
        </div>

        <div className="sidebar-storage">
          <p className="storage-label">Storage</p>
          <div className="storage-bar">
            <div
              className="storage-bar-fill"
              style={{ width: `${Math.min(storageUsage.percentUsed, 100)}%` }}
            />
          </div>
          <p className="storage-text">
            {storageUsage.usedKB} KB / {storageUsage.limitKB} KB ({storageUsage.percentUsed}%)
          </p>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
