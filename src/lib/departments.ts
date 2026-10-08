export const DEPARTMENTS = ["戦略", "業務", "IT", "人事", "営業", "管理"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const isDepartment = (v: unknown): v is Department =>
  typeof v === "string" && (DEPARTMENTS as readonly string[]).includes(v);
