"use client";

import React, { useEffect, useState } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Unlock, FileText, FolderOpen, Loader2, AlertTriangle, Info } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { cn } from '@/lib/utils';
import type { TRPCClientErrorLike } from '@trpc/client';
import type { FormRouter } from '@/server/api/routers/formRouter'; // Assuming FormRouter type is exported

type FormListItem = RouterOutputs["form"]["listForms"]["items"][number];
type UserRole = RouterOutputs["form"]["getCurrentUserServerRoles"][number];
type PublicFormCategory = RouterOutputs["form"]["listCategoriesPublic"][number]; 
type ClientFormCategory = PublicFormCategory & { forms: FormListItem[] };

export default function UserFormList() {
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [initialRolesLoadAttempted, setInitialRolesLoadAttempted] = useState(false);

  const { 
    data: currentUserRolesData, 
    isLoading: isLoadingRoles, 
    error: rolesError, 
    isError: isRolesError, 
    isSuccess: isRolesSuccess 
  } = api.form.getCurrentUserServerRoles.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (isRolesSuccess && currentUserRolesData) {
      setUserRoles(currentUserRolesData.map(role => role.roleId));
      setInitialRolesLoadAttempted(true);
    } else if (isRolesError) {
      console.error("Failed to load user roles:", rolesError);
      // toast.error("Could not load your permissions. Form access might be inaccurate.");
      setInitialRolesLoadAttempted(true); // Mark as attempted even on error
    }
  }, [isRolesSuccess, currentUserRolesData, isRolesError, rolesError]);

  const categoriesQuery = api.form.listCategoriesPublic.useQuery(undefined, { 
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const formsQuery = api.form.listForms.useQuery({}, { 
    refetchOnWindowFocus: false, 
    retry: 1,
  });

  // isLoadingUserRoles is true if roles are loading AND the initial load hasn't been attempted yet.
  const isLoadingUserRoles = isLoadingRoles && !initialRolesLoadAttempted;
  const effectiveIsLoading = categoriesQuery.isLoading || formsQuery.isLoading || isLoadingUserRoles;
  const displayError = rolesError ?? categoriesQuery.error ?? formsQuery.error;

  const categorizedForms = React.useMemo(() => {
    if (!categoriesQuery.data || !formsQuery.data?.items) return [];
    
    const categoriesMap = new Map<number, ClientFormCategory>();
    categoriesQuery.data.forEach(cat => {
      categoriesMap.set(cat.id, { ...cat, forms: [] });
    });

    const uncategorizedForms: FormListItem[] = [];

    formsQuery.data.items.forEach(form => {
      if (form.categoryId && categoriesMap.has(form.categoryId)) {
        categoriesMap.get(form.categoryId)!.forms.push(form);
      } else {
        uncategorizedForms.push(form);
      }
    });

    const result = Array.from(categoriesMap.values());
    if (uncategorizedForms.length > 0) {
      const now = new Date();
      result.push({
        id: 0, 
        name: "Other Forms",
        description: null,
        createdAt: now, 
        updatedAt: now, 
        formsCount: uncategorizedForms.length,
        forms: uncategorizedForms,
      });
    }
    return result.filter(category => category.forms.length > 0);
  }, [categoriesQuery.data, formsQuery.data?.items]);

  const canAccessForm = (form: FormListItem) => {
    if (isLoadingUserRoles) return false; // Still determining access
    if (isRolesError) return false; // Cannot determine access due to error, assume no access for safety
    if (!form.accessRoleIds || form.accessRoleIds.length === 0) return true;
    return userRoles.some(userRole => form.accessRoleIds!.includes(userRole));
  };

  if (effectiveIsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg">Loading available forms...</p>
      </div>
    );
  }

  if (displayError && categorizedForms.length === 0) {
    return (
      <Card className="w-full max-w-lg mx-auto border-destructive">
        <CardHeader className="text-center space-y-3">
          <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
          <CardTitle className="text-2xl">Error Loading Forms</CardTitle>
          <CardDescription className="text-base text-destructive">
            {displayError.message ?? "An unexpected error occurred. Please try again later."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pt-6">
            <Button onClick={() => {
                if (rolesError) void api.form.getCurrentUserServerRoles.useQuery().refetch();
                if (categoriesQuery.error) void categoriesQuery.refetch();
                if (formsQuery.error) void formsQuery.refetch();
            }} size="lg">Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  if (categorizedForms.length === 0 && (formsQuery.data?.items?.length ?? 0) === 0) {
     return (
      <Card className="w-full text-center py-12 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <FolderOpen className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <CardTitle className="text-2xl">No Forms Available</CardTitle>
          <CardDescription className="mt-2 text-muted-foreground">
            There are currently no forms available for you to fill out, or you may not have permissions for existing ones.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-10">
      {isRolesError && (
        <div className="mb-4 p-4 bg-destructive/10 border border-destructive/30 rounded-md text-destructive-foreground">
            <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> 
                <span className="font-semibold">Permissions Error:</span>
            </div>
            <p className="text-sm ml-7">Could not load your permissions. Form access might be inaccurate. <Button variant="link" size="sm" className="p-0 h-auto text-destructive-foreground hover:underline" onClick={() =>  void api.form.getCurrentUserServerRoles.useQuery().refetch()}>Retry loading permissions.</Button></p>
        </div>
      )}
      {categorizedForms.map((category) => (
        <section key={category.id} aria-labelledby={`category-title-${category.id}`}>
          <div className="mb-6 pb-3 border-b border-border">
            <h2 id={`category-title-${category.id}`} className="text-2xl font-semibold tracking-tight text-foreground">
              {category.name}
            </h2>
            {category.description && <p className="mt-1 text-sm text-muted-foreground">{category.description}</p>}
          </div>
          {category.forms.length === 0 ? (
             <div className="text-center py-8 border border-dashed rounded-lg bg-card/30">
                <Info className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No forms currently in this category that are accessible or available to you.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {category.forms.map((form) => {
                const hasAccess = canAccessForm(form);
                return (
                  <Card key={form.id} className={cn(
                    "flex flex-col transition-all duration-200 ease-in-out transform hover:-translate-y-1",
                    hasAccess ? "hover:shadow-xl bg-card" : "opacity-70 bg-muted/40 cursor-not-allowed"
                  )}>
                    <CardHeader className="pb-4">
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-lg font-semibold leading-tight">{form.title}</CardTitle>
                        {isLoadingUserRoles ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : hasAccess ? (
                          <Unlock className="h-5 w-5 text-green-500 flex-shrink-0" />
                        ) : (
                          <Lock className="h-5 w-5 text-destructive flex-shrink-0" />
                        )}
                      </div>
                      {form.description && <CardDescription className="mt-2 text-sm line-clamp-3 h-[3.75rem]">{form.description}</CardDescription>}
                    </CardHeader>
                    <CardContent className="flex-grow py-2">
                      <Badge variant="outline" className="text-xs font-medium">
                        {form.questions?.length ?? 0} questions
                      </Badge>
                      {form.categoryId && categoriesQuery.data?.find(c=>c.id === form.categoryId) &&
                        <Badge variant="secondary" className="ml-2 text-xs font-medium">
                            {categoriesQuery.data?.find(c=>c.id === form.categoryId)?.name}
                        </Badge>
                      }
                    </CardContent>
                    <CardFooter className="pt-4 border-t border-border/60 mt-auto">
                      {hasAccess ? (
                        <Button asChild className="w-full group" variant="default">
                          <Link href={`/dashboard/form/${form.id}`} className="flex items-center justify-center gap-2">
                            <FileText className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" /> Open Form
                          </Link>
                        </Button>
                      ) : (
                        <Button className="w-full" disabled variant="secondary">
                          <Lock className="mr-2 h-4 w-4" /> Access Denied
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
} 