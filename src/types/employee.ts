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
  photo: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EmployeeFormData = Omit<Employee, "id" | "createdAt" | "updatedAt">;

export type AppView =
  | { page: "list" }
  | { page: "detail"; employeeId: string }
  | { page: "add" }
  | { page: "edit"; employeeId: string };
