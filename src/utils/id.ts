export function generateId(): string {
  return `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}
