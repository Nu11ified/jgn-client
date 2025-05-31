// Utility types for Drizzle to reduce redundancy
// This provides a pattern to generate both Select and Insert types from a single table definition

import type { Table } from "drizzle-orm";

// Generic type to extract Select type from any Drizzle table
export type SelectType<T extends Table> = T["$inferSelect"];

// Generic type to extract Insert type from any Drizzle table  
export type InsertType<T extends Table> = T["$inferInsert"];

// Utility type to generate both Select and Insert types from a table
export type TableTypes<T extends Table> = {
  Select: SelectType<T>;
  Insert: InsertType<T>;
};

// Example usage:
// Instead of:
// export type Department = typeof departments.$inferSelect;
// export type NewDepartment = typeof departments.$inferInsert;
//
// Use:
// export type DepartmentTypes = TableTypes<typeof departments>;
// Then access as DepartmentTypes["Select"] and DepartmentTypes["Insert"]
//
// Or use the individual utilities:
// export type Department = SelectType<typeof departments>;
// export type NewDepartment = InsertType<typeof departments>; 