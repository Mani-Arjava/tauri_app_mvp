import { useState } from "react";
import type { EmployeeFormData } from "../types/employee";
import { ImageUpload } from "./ImageUpload";

interface EmployeeFormProps {
  initialData?: EmployeeFormData;
  onSubmit: (data: EmployeeFormData) => void;
  onCancel: () => void;
  isEditing: boolean;
}

const EMPTY_FORM: EmployeeFormData = {
  name: "",
  employeeId: "",
  email: "",
  phone: "",
  department: "",
  designation: "",
  dateOfBirth: "",
  dateOfJoining: "",
  address: "",
  photo: null,
};

export function EmployeeForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing,
}: EmployeeFormProps) {
  const [form, setForm] = useState<EmployeeFormData>(initialData || EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setField = (field: keyof EmployeeFormData, value: string | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.employeeId.trim()) errs.employeeId = "Employee ID is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!form.email.includes("@")) errs.email = "Email must contain @";
    if (!form.phone.trim()) errs.phone = "Phone is required";
    if (!form.department.trim()) errs.department = "Department is required";
    if (!form.designation.trim()) errs.designation = "Designation is required";
    if (!form.dateOfBirth) errs.dateOfBirth = "Date of birth is required";
    else if (new Date(form.dateOfBirth) >= new Date())
      errs.dateOfBirth = "Date of birth must be in the past";
    if (!form.dateOfJoining) errs.dateOfJoining = "Date of joining is required";
    if (!form.address.trim()) errs.address = "Address is required";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(form);
    }
  };

  return (
    <form className="employee-form" onSubmit={handleSubmit}>
      <h2 className="form-title">
        {isEditing ? "Edit Employee" : "Add New Employee"}
      </h2>

      <ImageUpload
        currentImage={form.photo}
        onImageChange={(photo) => setField("photo", photo)}
      />

      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            className={errors.name ? "input-error" : ""}
          />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </div>

        <div className="form-field">
          <label htmlFor="employeeId">Employee ID</label>
          <input
            id="employeeId"
            type="text"
            value={form.employeeId}
            onChange={(e) => setField("employeeId", e.target.value)}
            placeholder="e.g., EMP-001"
            className={errors.employeeId ? "input-error" : ""}
          />
          {errors.employeeId && (
            <span className="field-error">{errors.employeeId}</span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            className={errors.email ? "input-error" : ""}
          />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </div>

        <div className="form-field">
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            className={errors.phone ? "input-error" : ""}
          />
          {errors.phone && <span className="field-error">{errors.phone}</span>}
        </div>

        <div className="form-field">
          <label htmlFor="department">Department</label>
          <input
            id="department"
            type="text"
            value={form.department}
            onChange={(e) => setField("department", e.target.value)}
            placeholder="e.g., Engineering"
            className={errors.department ? "input-error" : ""}
          />
          {errors.department && (
            <span className="field-error">{errors.department}</span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="designation">Designation</label>
          <input
            id="designation"
            type="text"
            value={form.designation}
            onChange={(e) => setField("designation", e.target.value)}
            placeholder="e.g., Senior Developer"
            className={errors.designation ? "input-error" : ""}
          />
          {errors.designation && (
            <span className="field-error">{errors.designation}</span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="dateOfBirth">Date of Birth</label>
          <input
            id="dateOfBirth"
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setField("dateOfBirth", e.target.value)}
            className={errors.dateOfBirth ? "input-error" : ""}
          />
          {errors.dateOfBirth && (
            <span className="field-error">{errors.dateOfBirth}</span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="dateOfJoining">Date of Joining</label>
          <input
            id="dateOfJoining"
            type="date"
            value={form.dateOfJoining}
            onChange={(e) => setField("dateOfJoining", e.target.value)}
            className={errors.dateOfJoining ? "input-error" : ""}
          />
          {errors.dateOfJoining && (
            <span className="field-error">{errors.dateOfJoining}</span>
          )}
        </div>

        <div className="form-field form-field-full">
          <label htmlFor="address">Address</label>
          <textarea
            id="address"
            value={form.address}
            onChange={(e) => setField("address", e.target.value)}
            rows={3}
            className={errors.address ? "input-error" : ""}
          />
          {errors.address && (
            <span className="field-error">{errors.address}</span>
          )}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          {isEditing ? "Update Employee" : "Save Employee"}
        </button>
      </div>
    </form>
  );
}
