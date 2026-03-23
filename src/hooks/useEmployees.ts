import { useState, useMemo } from "react";
import type { Employee, EmployeeFormData } from "../types/employee";
import * as storage from "../utils/storage";

export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>(() =>
    storage.getAllEmployees()
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => setEmployees(storage.getAllEmployees());

  const clearError = () => setError(null);

  const addEmployee = (data: EmployeeFormData): Employee | null => {
    try {
      const emp = storage.addEmployee(data);
      refresh();
      return emp;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add employee");
      return null;
    }
  };

  const updateEmployee = (id: string, data: EmployeeFormData): Employee | null => {
    try {
      const emp = storage.updateEmployee(id, data);
      refresh();
      return emp;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update employee");
      return null;
    }
  };

  const deleteEmployee = (id: string): void => {
    storage.deleteEmployee(id);
    refresh();
  };

  const getById = (id: string): Employee | undefined => {
    return storage.getEmployeeById(id);
  };

  const filteredEmployees = useMemo(() => {
    if (!searchTerm) return employees;
    const term = searchTerm.toLowerCase();
    return employees.filter(
      (emp) =>
        emp.name.toLowerCase().includes(term) ||
        emp.employeeId.toLowerCase().includes(term) ||
        emp.department.toLowerCase().includes(term) ||
        emp.designation.toLowerCase().includes(term)
    );
  }, [employees, searchTerm]);

  const storageUsage = useMemo(() => storage.getStorageUsage(), [employees]);

  return {
    employees: filteredEmployees,
    totalCount: employees.length,
    searchTerm,
    setSearchTerm,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    getById,
    storageUsage,
    error,
    clearError,
  };
}
