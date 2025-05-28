"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, ListChecks, FolderOpen } from "lucide-react";
import FormCategoriesAdmin from "@/app/_components/admin/forms/FormCategoriesAdmin";
import FormsAdmin from "@/app/_components/admin/forms/FormsAdmin";
import FormResponsesAdmin from "@/app/_components/admin/forms/FormResponsesAdmin";

export default function FormAdminPage() {
  return (
    <div className="container mx-auto max-w-5xl py-8 px-4 sm:px-6 lg:px-8 space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Form Administration</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Manage form categories, create and edit forms, and view submitted responses.
        </p>
      </header>

      <Tabs defaultValue="forms" className="w-full">
        <TabsList className="mb-6 bg-card p-1 rounded-lg shadow-sm h-auto sm:h-10">
          <TabsTrigger value="forms" className="flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all duration-200 ease-in-out">
            <FileText className="h-4 w-4 sm:h-5 sm:w-5" /> Forms
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all duration-200 ease-in-out">
            <FolderOpen className="h-4 w-4 sm:h-5 sm:w-5" /> Categories
          </TabsTrigger>
          <TabsTrigger value="responses" className="flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all duration-200 ease-in-out">
            <ListChecks className="h-4 w-4 sm:h-5 sm:w-5" /> Responses
          </TabsTrigger>
        </TabsList>

        <TabsContent value="forms">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>Manage Forms</CardTitle>
              <CardDescription>Create, edit, and delete forms.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormsAdmin />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>Manage Categories</CardTitle>
              <CardDescription>Create and delete form categories.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormCategoriesAdmin />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="responses">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>View Responses</CardTitle>
              <CardDescription>Review and filter submitted form responses.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormResponsesAdmin /> 
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 