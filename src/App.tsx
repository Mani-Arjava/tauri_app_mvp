import { useState } from "react";
import type { Employee, EmployeeFormData, AppView } from "./types/employee";
import { useEmployees } from "./hooks/useEmployees";
import { Layout } from "./components/Layout";
import { EmployeeList } from "./components/EmployeeList";
import { EmployeeDetail } from "./components/EmployeeDetail";
import { EmployeeForm } from "./components/EmployeeForm";
import { DeleteConfirmDialog } from "./components/DeleteConfirmDialog";

export function App() {
  const [view, setView] = useState<AppView>({ page: "list" });
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const empState = useEmployees();

  const nav = {
    toList: () => setView({ page: "list" }),
    toDetail: (id: string) => setView({ page: "detail", employeeId: id }),
    toAdd: () => setView({ page: "add" }),
    toEdit: (id: string) => setView({ page: "edit", employeeId: id }),
  };

  const handleAdd = (data: EmployeeFormData) => {
    const result = empState.addEmployee(data);
    if (result) nav.toList();
  };

  const handleUpdate = (id: string, data: EmployeeFormData) => {
    const result = empState.updateEmployee(id, data);
    if (result) nav.toDetail(id);
  };

  const handleDelete = () => {
    if (deleteTarget) {
      empState.deleteEmployee(deleteTarget.id);
      setDeleteTarget(null);
      nav.toList();
    }
  };

  let content: React.JSX.Element;
  switch (view.page) {
    case "list":
      content = (
        <EmployeeList
          employees={empState.employees}
          totalCount={empState.totalCount}
          searchTerm={empState.searchTerm}
          onSearchChange={empState.setSearchTerm}
          onView={nav.toDetail}
          onEdit={nav.toEdit}
          onDelete={setDeleteTarget}
        />
      );
      break;

    case "detail": {
      const employee = empState.getById(view.employeeId);
      if (!employee) {
        nav.toList();
        content = <></>;
        break;
      }
      content = (
        <EmployeeDetail
          employee={employee}
          onEdit={() => nav.toEdit(employee.id)}
          onDelete={() => setDeleteTarget(employee)}
          onBack={nav.toList}
        />
      );
      break;
    }

    case "add":
      content = (
        <EmployeeForm
          isEditing={false}
          onSubmit={handleAdd}
          onCancel={nav.toList}
        />
      );
      break;

    case "edit": {
      const employee = empState.getById(view.employeeId);
      if (!employee) {
        nav.toList();
        content = <></>;
        break;
      }
      const { id: _, createdAt: __, updatedAt: ___, ...formData } = employee;
      content = (
        <EmployeeForm
          isEditing={true}
          initialData={formData}
          onSubmit={(data) => handleUpdate(employee.id, data)}
          onCancel={() => nav.toDetail(employee.id)}
        />
      );
      break;
    }
  }

  return (
    <Layout
      currentPage={view.page}
      totalCount={empState.totalCount}
      storageUsage={empState.storageUsage}
      onNavigateToList={nav.toList}
      onNavigateToAdd={nav.toAdd}
    >
      {empState.error && (
        <div className="error-banner">
          <p>{empState.error}</p>
          <button className="btn btn-small" onClick={empState.clearError}>
            Dismiss
          </button>
        </div>
      )}
      {content}
      <DeleteConfirmDialog
        isOpen={deleteTarget !== null}
        employeeName={deleteTarget?.name || ""}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Layout>
  );
}
