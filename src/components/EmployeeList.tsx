import type { Employee } from "../types/employee";
import { SearchBar } from "./SearchBar";

interface EmployeeListProps {
  employees: Employee[];
  totalCount: number;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (employee: Employee) => void;
}

export function EmployeeList({
  employees,
  totalCount,
  searchTerm,
  onSearchChange,
  onView,
  onEdit,
  onDelete,
}: EmployeeListProps) {
  if (totalCount === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-text">
          No employees yet. Click &quot;Add Employee&quot; to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="employee-list">
      <SearchBar value={searchTerm} onChange={onSearchChange} />

      {employees.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-text">
            No employees match &quot;{searchTerm}&quot;.
          </p>
        </div>
      ) : (
        <>
          <table className="employee-table">
            <thead>
              <tr>
                <th className="col-photo">Photo</th>
                <th>Name</th>
                <th>Emp ID</th>
                <th>Department</th>
                <th>Designation</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="employee-row"
                  onClick={() => onView(emp.id)}
                >
                  <td className="col-photo">
                    <img
                      src={emp.photo || "/placeholder-avatar.svg"}
                      alt={emp.name}
                      className="table-avatar"
                    />
                  </td>
                  <td>{emp.name}</td>
                  <td>{emp.employeeId}</td>
                  <td>{emp.department}</td>
                  <td>{emp.designation}</td>
                  <td className="col-actions">
                    <button
                      className="btn btn-small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(emp.id);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-small btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(emp);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="list-count">
            Showing {employees.length} of {totalCount} employee{totalCount !== 1 ? "s" : ""}
          </p>
        </>
      )}
    </div>
  );
}
