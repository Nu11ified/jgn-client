import React from "react";
import { AdminNavbar } from "@/app/_components/admin/AdminNavbar";

export const dynamic = 'force-dynamic';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminNavbar />
      <main className="container mx-auto py-8 px-4 md:px-6 lg:px-8 mt-8">
        {children}
      </main>
    </div>
  );
} 