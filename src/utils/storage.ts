import type { Employee, EmployeeFormData } from "../types/employee";
import { generateId } from "./id";

const STORAGE_KEY = "employee_data";

function saveToStorage(employees: Employee[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(employees));
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      throw new Error(
        "Storage is full. Please delete some employees or remove photos to free up space."
      );
    }
    throw e;
  }
}

export function getAllEmployees(): Employee[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as Employee[];
}

export function getEmployeeById(id: string): Employee | undefined {
  return getAllEmployees().find((emp) => emp.id === id);
}

export function addEmployee(data: EmployeeFormData): Employee {
  const employees = getAllEmployees();
  const now = new Date().toISOString();
  const employee: Employee = {
    ...data,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  employees.push(employee);
  saveToStorage(employees);
  return employee;
}

export function updateEmployee(
  id: string,
  data: EmployeeFormData
): Employee {
  const employees = getAllEmployees();
  const index = employees.findIndex((emp) => emp.id === id);
  if (index === -1) throw new Error(`Employee ${id} not found`);

  const updated: Employee = {
    ...employees[index],
    ...data,
    id,
    createdAt: employees[index].createdAt,
    updatedAt: new Date().toISOString(),
  };
  employees[index] = updated;
  saveToStorage(employees);
  return updated;
}

export function deleteEmployee(id: string): void {
  const employees = getAllEmployees().filter((emp) => emp.id !== id);
  saveToStorage(employees);
}

export function getStorageUsage(): {
  usedKB: number;
  limitKB: number;
  percentUsed: number;
} {
  const data = localStorage.getItem(STORAGE_KEY) || "";
  const usedBytes = new Blob([data]).size;
  const usedKB = Math.round((usedBytes / 1024) * 10) / 10;
  const limitKB = 5120; // ~5MB
  const percentUsed = Math.round((usedKB / limitKB) * 1000) / 10;
  return { usedKB, limitKB, percentUsed };
}
