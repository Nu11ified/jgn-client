import { api } from "@/trpc/server";
import DepartmentsClient from "@/app/_components/admin/DepartmentsClient";

export default async function DepartmentsPage() {
  const departments = await api.dept.admin.departments.list();

  return <DepartmentsClient initialDepartments={departments} />;
} 