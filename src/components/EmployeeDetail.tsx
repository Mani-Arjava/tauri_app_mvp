import type { Employee } from "../types/employee";

interface EmployeeDetailProps {
  employee: Employee;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function EmployeeDetail({
  employee,
  onEdit,
  onDelete,
  onBack,
}: EmployeeDetailProps) {
  return (
    <div className="employee-detail">
      <button className="btn btn-back" onClick={onBack}>
        &larr; Back to List
      </button>

      <div className="detail-header">
        <img
          src={employee.photo || "/placeholder-avatar.svg"}
          alt={employee.name}
          className="detail-photo"
        />
        <div className="detail-info">
          <h2 className="detail-name">{employee.name}</h2>
          <p className="detail-field">
            <span className="detail-label">Employee ID:</span> {employee.employeeId}
          </p>
          <p className="detail-field">
            <span className="detail-label">Email:</span> {employee.email}
          </p>
          <p className="detail-field">
            <span className="detail-label">Phone:</span> {employee.phone}
          </p>
          <p className="detail-field">
            <span className="detail-label">Department:</span> {employee.department}
          </p>
          <p className="detail-field">
            <span className="detail-label">Designation:</span> {employee.designation}
          </p>
        </div>
      </div>

      <div className="detail-body">
        <p className="detail-field">
          <span className="detail-label">Date of Birth:</span>{" "}
          {formatDate(employee.dateOfBirth)}
        </p>
        <p className="detail-field">
          <span className="detail-label">Date of Joining:</span>{" "}
          {formatDate(employee.dateOfJoining)}
        </p>
        <p className="detail-field">
          <span className="detail-label">Address:</span> {employee.address}
        </p>
      </div>

      <div className="detail-meta">
        <p className="meta-text">Created: {formatDate(employee.createdAt)}</p>
        <p className="meta-text">Last Updated: {formatDate(employee.updatedAt)}</p>
      </div>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={onEdit}>
          Edit
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
