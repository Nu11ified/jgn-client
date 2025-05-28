"use client";

import React, { useState } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, PlusCircle, Trash2, AlertTriangle, FolderOpen } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";

type FormCategoryWithCount = RouterOutputs["form"]["listCategories"][number];

export default function FormCategoriesAdmin() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");
  const [categoryToDelete, setCategoryToDelete] = useState<FormCategoryWithCount | null>(null);

  const utils = api.useUtils();
  const categoriesQuery = api.form.listCategories.useQuery(undefined, { refetchOnWindowFocus: false });

  const createCategoryMutation = api.form.createCategory.useMutation({
    onSuccess: () => {
      toast.success("Category created successfully!");
      void utils.form.listCategories.invalidate();
      setIsCreateDialogOpen(false);
      setNewCategoryName("");
      setNewCategoryDescription("");
    },
    onError: (error) => toast.error(`Failed to create category: ${error.message}`),
  });

  const deleteCategoryMutation = api.form.deleteCategory.useMutation({
    onSuccess: () => {
      toast.success(`Category deleted successfully!`);
      void utils.form.listCategories.invalidate();
      setCategoryToDelete(null);
    },
    onError: (error) => {
      toast.error(`Failed to delete category: ${error.message}`);
      setCategoryToDelete(null);
    },
  });

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) {
      toast.warning("Category name cannot be empty.");
      return;
    }
    createCategoryMutation.mutate({ name: newCategoryName.trim(), description: newCategoryDescription.trim() || undefined });
  };

  const handleDeleteConfirmation = () => {
    if (categoryToDelete) deleteCategoryMutation.mutate({ categoryId: categoryToDelete.id });
  };
  
  if (categoriesQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg">Loading categories...</p>
      </div>
    );
  }

  if (categoriesQuery.isError) {
    return (
      <Card className="w-full max-w-lg mx-auto border-destructive">
        <CardHeader className="text-center space-y-3">
          <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
          <CardTitle className="text-2xl">Error Loading Categories</CardTitle>
          <CardDescription className="text-base text-destructive">
            {categoriesQuery.error?.message ?? "An unexpected error occurred."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pt-6">
            <Button onClick={() => utils.form.listCategories.invalidate()} size="lg">Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  const categories = categoriesQuery.data ?? [];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Manage Categories</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg">
              <PlusCircle className="mr-2 h-5 w-5" /> Create New Category
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader className="pt-2">
              <DialogTitle className="text-xl">Create New Category</DialogTitle>
              <DialogDescription>
                Enter a name and optional description for the new category.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-category-name">Name</Label>
                <Input
                  id="new-category-name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g., Staff Applications"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-category-description">Description (Optional)</Label>
                <Textarea
                  id="new-category-description"
                  value={newCategoryDescription}
                  onChange={(e) => setNewCategoryDescription(e.target.value)}
                  placeholder="A brief summary of this category"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline" size="default">Cancel</Button></DialogClose>
              <Button onClick={handleCreateCategory} disabled={createCategoryMutation.isPending} size="default">
                {createCategoryMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Category
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {categories.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg space-y-3">
            <FolderOpen className="mx-auto h-16 w-16 text-muted-foreground" />
            <h3 className="text-xl font-semibold">No Categories Yet</h3>
            <p className="text-muted-foreground">Click the button above to create your first category.</p>
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <ScrollArea className="max-h-[60vh] border rounded-md">
              <Table className="relative">
                <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="w-[35%]">Name</TableHead>
                    <TableHead className="w-[45%]">Description</TableHead>
                    <TableHead className="text-center">Forms</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((category) => (
                    <TableRow key={category.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium py-3">{category.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground py-3 truncate max-w-sm">{category.description ?? <span className="italic">N/A</span>}</TableCell>
                       <TableCell className="text-center text-sm py-3">{category.formsCount ?? 0}</TableCell>
                      <TableCell className="text-right py-3">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="Delete Category" onClick={() => setCategoryToDelete(category)} className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          {categoryToDelete && categoryToDelete.id === category.id && (
                            <DialogContent>
                                <DialogHeader>
                                <DialogTitle className="text-xl">Delete Category: {categoryToDelete.name}</DialogTitle>
                                <DialogDescription>
                                    Are you sure you want to delete this category? Forms in this category will be unlinked. This action cannot be undone.
                                </DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                <DialogClose asChild><Button variant="outline" onClick={() => setCategoryToDelete(null)}>Cancel</Button></DialogClose>
                                <Button variant="destructive" onClick={handleDeleteConfirmation} disabled={deleteCategoryMutation.isPending}>
                                    {deleteCategoryMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Delete Category
                                </Button>
                                </DialogFooter>
                            </DialogContent>
                          )}
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
} 