import { api } from "@/trpc/server";
import { notFound } from "next/navigation";
import DepartmentDetailClient from "@/app/_components/admin/DepartmentDetailClient";

interface DepartmentDetailPageProps {
  params: {
    id: string;
  };
}

export default async function DepartmentDetailPage({ params }: DepartmentDetailPageProps) {
  const departmentId = parseInt(params.id);
  
  if (isNaN(departmentId)) {
    notFound();
  }

  try {
    const department = await api.dept.admin.departments.getById({ id: departmentId });
    return <DepartmentDetailClient department={department} />;
  } catch (error) {
    console.error("Error fetching department details:", error);
    notFound();
  }
} 