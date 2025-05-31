"use client";

import React from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, type RouterOutputs } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { Loader2 } from 'lucide-react';

// Form schema based on the createDepartmentSchema from the router
const createDepartmentFormSchema = z.object({
  name: z.string().min(1, "Department name is required").max(256, "Name must be 256 characters or less"),
  type: z.enum(["law_enforcement", "fire_department", "staff_team"], {
    required_error: "Please select a department type",
  }),
  description: z.string().max(1000, "Description must be 1000 characters or less").optional(),
  discordGuildId: z.string().min(1, "Discord Guild ID is required").max(30, "Guild ID must be 30 characters or less"),
  discordCategoryId: z.string().max(30, "Category ID must be 30 characters or less").optional(),
  callsignPrefix: z.string().min(1, "Callsign prefix is required").max(10, "Prefix must be 10 characters or less").regex(/^[A-Z]+$/, "Callsign prefix must contain only uppercase letters"),
});

type CreateDepartmentFormValues = z.infer<typeof createDepartmentFormSchema>;
type Department = RouterOutputs["dept"]["admin"]["departments"]["list"][0];

interface CreateDepartmentFormProps {
  onSuccess: (department: Department) => void;
}

const DEPARTMENT_TYPE_OPTIONS = [
  { value: "law_enforcement", label: "Law Enforcement" },
  { value: "fire_department", label: "Fire Department" },
  { value: "staff_team", label: "Staff Team" },
] as const;

export function CreateDepartmentForm({ onSuccess }: CreateDepartmentFormProps) {
  const form = useForm<CreateDepartmentFormValues>({
    resolver: zodResolver(createDepartmentFormSchema),
    defaultValues: {
      name: "",
      type: undefined,
      description: "",
      discordGuildId: "",
      discordCategoryId: "",
      callsignPrefix: "",
    },
  });

  const createDepartmentMutation = api.dept.admin.departments.create.useMutation({
    onSuccess: (data) => {
      if (data) {
        toast.success("Department created successfully!");
        form.reset();
        onSuccess(data);
      } else {
        toast.error("Department created but data was not returned");
      }
    },
    onError: (error) => {
      toast.error(`Failed to create department: ${error.message}`);
    },
  });

  const onSubmit = (data: CreateDepartmentFormValues) => {
    // Transform the data to match the API expectations
    const payload = {
      ...data,
      description: data.description?.trim() ?? undefined,
      discordCategoryId: data.discordCategoryId?.trim() ?? undefined,
      callsignPrefix: data.callsignPrefix.toUpperCase(), // Ensure uppercase
    };
    
    createDepartmentMutation.mutate(payload);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Los Santos Police Department" />
              </FormControl>
              <FormDescription>
                The full name of the department
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {DEPARTMENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                The type/category of this department
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="callsignPrefix"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Callsign Prefix</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="LSPD" 
                  className="uppercase"
                  onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                />
              </FormControl>
              <FormDescription>
                Short prefix for callsigns (e.g., LSPD, SAFD, STAFF). Only uppercase letters allowed.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="discordGuildId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Discord Guild ID</FormLabel>
              <FormControl>
                <Input {...field} placeholder="123456789012345678" />
              </FormControl>
              <FormDescription>
                The Discord server ID where this department operates
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="discordCategoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Discord Category ID (Optional)</FormLabel>
              <FormControl>
                <Input {...field} placeholder="123456789012345678" />
              </FormControl>
              <FormDescription>
                The Discord category ID for department channels (optional)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (Optional)</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  placeholder="Brief description of the department..."
                  rows={3}
                />
              </FormControl>
              <FormDescription>
                Optional description of the department&apos;s role and responsibilities
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button 
            type="submit" 
            disabled={createDepartmentMutation.isPending}
            className="w-full sm:w-auto"
          >
            {createDepartmentMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Department
          </Button>
        </div>
      </form>
    </Form>
  );
} 