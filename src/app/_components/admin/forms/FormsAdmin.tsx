"use client";

import React, { useState } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, PlusCircle, Trash2, Edit3, AlertTriangle, FileText, Settings2, Users, Eye, Info, ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import type { FieldPath, FieldErrors, DeepPartial, Control, Path, UseFormSetValue, FieldValues, SubmitHandler } from "react-hook-form";
import { z } from "zod";
import type { FormQuestion as ServerFormQuestionDefinition } from "@/server/postgres/schema/form";
import { Badge } from "@/components/ui/badge";

const formQuestionTypes = ["true_false", "multiple_choice", "short_answer", "long_answer"] as const;
export type FormQuestionType = typeof formQuestionTypes[number];

type FormListItem = RouterOutputs["form"]["listForms"]["items"][number];
type FormCategory = RouterOutputs["form"]["listCategories"][number];

const clientBaseQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1, "Question text cannot be empty"),
});

const clientTrueFalseQuestionSchema = clientBaseQuestionSchema.extend({
  type: z.literal("true_false"),
});

const clientMultipleChoiceQuestionSchema = clientBaseQuestionSchema.extend({
  type: z.literal("multiple_choice"),
  options: z.array(z.string().min(1, "Option cannot be empty")).min(2, "At least two options are required"),
  allowMultiple: z.boolean().optional(),
});

const clientShortAnswerQuestionSchema = clientBaseQuestionSchema.extend({
  type: z.literal("short_answer"),
  maxLength: z.number().int().positive().optional().nullable(),
});

const clientLongAnswerQuestionSchema = clientBaseQuestionSchema.extend({
  type: z.literal("long_answer"),
  supportsMarkdown: z.boolean().optional().default(false),
  maxLength: z.number().int().positive().optional().nullable(),
});

export const clientFormQuestionSchema = z.discriminatedUnion("type", [
  clientTrueFalseQuestionSchema,
  clientMultipleChoiceQuestionSchema,
  clientShortAnswerQuestionSchema,
  clientLongAnswerQuestionSchema,
]);
export type ClientFormQuestion = z.infer<typeof clientFormQuestionSchema>;

const formSchema = z.object({
  id: z.number().optional(),
  title: z.string().min(1, "Title is required").max(256),
  description: z.string().max(1000).optional().nullable(),
  questions: z.array(clientFormQuestionSchema).min(1, "At least one question is required"),
  categoryId: z.preprocess((val) => val ? Number(val) : null, z.number().int().optional().nullable()),
  accessRoleIds: z.array(z.string().min(17).max(30)).optional().default([]),
  reviewerRoleIds: z.array(z.string().min(17).max(30)).optional().default([]),
  finalApproverRoleIds: z.array(z.string().min(17).max(30)).optional().default([]),
  requiredReviewers: z.preprocess((val) => val ? Number(val) : 0, z.number().int().min(0).default(1)),
  requiresFinalApproval: z.boolean().default(true),
});

export type FormValues = z.infer<typeof formSchema>;

const QuestionTypeLabels: Record<FormQuestionType, string> = {
  true_false: "True/False",
  multiple_choice: "Multiple Choice",
  short_answer: "Short Answer",
  long_answer: "Long Answer",
};

const generateNewQuestionClientSideId = () => crypto.randomUUID();

const createDefaultQuestion = (id: string, type: FormQuestionType): ClientFormQuestion => {
  const base = { id, text: "" };
  switch (type) {
    case "multiple_choice":
      return { ...base, type, options: ["Option 1", "Option 2"], allowMultiple: false };
    case "short_answer":
      return { ...base, type, maxLength: undefined }; 
    case "long_answer":
      return { ...base, type, supportsMarkdown: false, maxLength: undefined }; 
    case "true_false":
    default:
      return { ...base, type: "true_false" };
  }
};

function RoleIdTagInput({ value, onChange, placeholder }: { value: string[]; onChange: (val: string[]) => void; placeholder?: string }) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addRole = (role: string) => {
    const trimmed = role.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (input.trim()) {
        addRole(input);
        setInput("");
      }
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      // Remove last tag on backspace
      onChange(value.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (text.includes(",")) {
      e.preventDefault();
      text.split(",").map(s => s.trim()).filter(Boolean).forEach(addRole);
      setInput("");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border rounded px-2 py-1 min-h-[2.5rem] bg-background focus-within:ring-2 ring-primary">
      {value.map((role, idx) => (
        <span key={role + idx} className="flex items-center bg-muted rounded px-2 py-0.5 text-sm mr-1">
          {role}
          <button type="button" className="ml-1 text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, i) => i !== idx))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-sm py-1"
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        aria-label="Add role ID"
      />
    </div>
  );
}

export default function FormsAdmin() {
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<FormListItem | null>(null);
  const [formToDelete, setFormToDelete] = useState<FormListItem | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number | null>(null);

  const formMethods = useForm<FormValues>({
    defaultValues: {
      title: "",
      description: "",
      questions: [createDefaultQuestion(generateNewQuestionClientSideId(), 'short_answer')],
      categoryId: null,
      accessRoleIds: [],
      reviewerRoleIds: [],
      finalApproverRoleIds: [],
      requiredReviewers: 1,
      requiresFinalApproval: true,
    } as DeepPartial<FormValues>,
  });

  const { fields: questionFields, append: appendQuestion, remove: removeQuestion, move: moveQuestion } = useFieldArray({
    control: formMethods.control,
    name: "questions",
    keyName: "id",
  });

  const formsQuery = api.form.listForms.useQuery({}, { refetchOnWindowFocus: false });
  const categoriesQuery = api.form.listCategories.useQuery(undefined, { refetchOnWindowFocus: false });

  type CreateFormInput = Parameters<typeof createFormMutation.mutate>[0];
  type EditFormInput = Parameters<typeof editFormMutation.mutate>[0];

  const createFormMutation = api.form.createForm.useMutation({
    onSuccess: () => {
      toast.success("Form created successfully!");
      void formsQuery.refetch();
      setIsFormDialogOpen(false);
      formMethods.reset({
        title: "",
        description: "",
        questions: [createDefaultQuestion(generateNewQuestionClientSideId(), 'short_answer')],
        categoryId: null, accessRoleIds: [], reviewerRoleIds: [],
        finalApproverRoleIds: [], requiredReviewers: 1, requiresFinalApproval: true,
      } as FormValues);
    },
    onError: (error) => toast.error(`Failed to create form: ${error.message}`),
  });

  const editFormMutation = api.form.editForm.useMutation({
    onSuccess: () => {
      toast.success("Form updated successfully!");
      void formsQuery.refetch();
      setIsFormDialogOpen(false);
      setEditingForm(null);
      formMethods.reset({
        title: "",
        description: "",
        questions: [createDefaultQuestion(generateNewQuestionClientSideId(), 'short_answer')],
        categoryId: null, accessRoleIds: [], reviewerRoleIds: [],
        finalApproverRoleIds: [], requiredReviewers: 1, requiresFinalApproval: true,
      } as FormValues);
    },
    onError: (error) => toast.error(`Failed to update form: ${error.message}`),
  });

  const deleteFormMutation = api.form.deleteForm.useMutation({
    onSuccess: () => {
      toast.success("Form deleted successfully!");
      void formsQuery.refetch();
      setFormToDelete(null);
    },
    onError: (error) => {
      toast.error(`Failed to delete form: ${error.message}`);
      setFormToDelete(null);
    }
  });

  const openCreateFormDialog = () => {
    setEditingForm(null);
    formMethods.reset({
        title: "",
        description: "", 
        questions: [createDefaultQuestion(generateNewQuestionClientSideId(), 'short_answer')],
        categoryId: null,
        accessRoleIds: [],
        reviewerRoleIds: [],
        finalApproverRoleIds: [],
        requiredReviewers: 1,
        requiresFinalApproval: true,
    } as FormValues);
  };

  const openEditFormDialog = (form: FormListItem) => {
    setEditingForm(form);
    const questionsForForm: ClientFormQuestion[] = (form.questions ?? []).map((qFromServer): ClientFormQuestion => {
      const id = qFromServer.id.toString();
      const text = qFromServer.text;
      switch (qFromServer.type) {
        case "multiple_choice":
          return { 
            id, text, type: "multiple_choice", 
            options: qFromServer.options ?? [], 
            allowMultiple: qFromServer.allowMultiple ?? false 
          };
        case "short_answer":
          return { 
            id, text, type: "short_answer", 
            maxLength: qFromServer.maxLength ?? undefined
          };
        case "long_answer":
          return { 
            id, text, type: "long_answer", 
            supportsMarkdown: qFromServer.supportsMarkdown ?? false, 
            maxLength: qFromServer.maxLength ?? undefined
          };
        case "true_false":
        default:
          return { id, text, type: "true_false" };
      }
    });

    formMethods.reset({
      id: form.id,
      title: form.title,
      description: form.description ?? "", 
      questions: questionsForForm.length > 0 ? questionsForForm : [createDefaultQuestion(generateNewQuestionClientSideId(), 'short_answer')],
      categoryId: form.categoryId,
      accessRoleIds: form.accessRoleIds ?? [], 
      reviewerRoleIds: form.reviewerRoleIds ?? [],
      finalApproverRoleIds: form.finalApproverRoleIds ?? [],
      requiredReviewers: form.requiredReviewers ?? 1,
      requiresFinalApproval: form.requiresFinalApproval ?? true,
    } as FormValues);
  };

  const onSubmit = (data: FieldValues) => {
    const values = data as FormValues;
    const questionsForApi = values.questions.map((qClient: ClientFormQuestion): ServerFormQuestionDefinition => {
        const { id: clientId, ...restOfClientQuestion } = qClient;
        
        // Initialize serverQuestionPayload with common fields, including the original clientId as a string.
        // The server schema for ServerFormQuestionDefinition must expect `id` as `string` or `string | number`
        // and handle its conversion or replacement if it's a UUID for new questions.
        let serverQuestionPayload: Partial<ServerFormQuestionDefinition> & { id: string } = {
            id: clientId, // Pass clientId directly as a string
            text: restOfClientQuestion.text,
            type: restOfClientQuestion.type, // Will be overwritten by specific types below but good for base
        };

        if (qClient.type === "short_answer" || qClient.type === "long_answer") {
            const clientSpecific = qClient;
            const maxLengthNum = clientSpecific.maxLength == null || clientSpecific.maxLength === undefined || Number.isNaN(Number(clientSpecific.maxLength))
                ? undefined 
                : Number(clientSpecific.maxLength);
            
            serverQuestionPayload = {
                ...serverQuestionPayload, // Spread base payload which includes id, text
                type: qClient.type, 
                maxLength: maxLengthNum,
                // Ensure all fields for ServerFormQuestionDefinition short_answer/long_answer are here
            } as Extract<ServerFormQuestionDefinition, {type: "short_answer" | "long_answer"}>;

            if (qClient.type === "long_answer") {
                 const longAnswerClientQuestion = qClient;
                 // Ensure the object being assigned to has the supportsMarkdown property defined in its type
                 (serverQuestionPayload as Extract<ServerFormQuestionDefinition, {type: "long_answer"}>).supportsMarkdown = longAnswerClientQuestion.supportsMarkdown ?? false;
            }
        } else if (qClient.type === "multiple_choice") {
            const clientSpecific = qClient;
            serverQuestionPayload = {
                ...serverQuestionPayload, // Spread base payload
                type: qClient.type, 
                options: Array.isArray(clientSpecific.options) ? clientSpecific.options : [],
                allowMultiple: clientSpecific.allowMultiple ?? false,
                // Ensure all fields for ServerFormQuestionDefinition multiple_choice are here
            } as Extract<ServerFormQuestionDefinition, {type: "multiple_choice"}>;
        } else if (qClient.type === "true_false") {
             // const clientSpecific = qClient; // Not strictly needed if only type and base are used
             serverQuestionPayload = {
                ...serverQuestionPayload, // Spread base payload
                type: qClient.type, 
                // Ensure all fields for ServerFormQuestionDefinition true_false are here
            } as Extract<ServerFormQuestionDefinition, {type: "true_false"}>;
        }

        // No longer need to convert clientId to Number or delete it here, as it's always passed as string.
        // The server should handle if id is a UUID (new) or a numeric string (existing, to be parsed).
        
        return serverQuestionPayload as ServerFormQuestionDefinition; // Final cast
    });

    const commonPayload = { 
        ...values, 
        description: values.description === "" ? null : values.description, 
        questions: questionsForApi 
    };

    if (editingForm && typeof values.id === 'number') {
      editFormMutation.mutate({ ...commonPayload, id: values.id } as EditFormInput);
    } else {
      const { id, ...createPayload } = commonPayload; // eslint-disable-line @typescript-eslint/no-unused-vars
      createFormMutation.mutate(createPayload as CreateFormInput);
    }
  };

  const handleDeleteForm = () => {
    if (formToDelete) {
      deleteFormMutation.mutate({ formId: formToDelete.id });
    }
  };
  
  const editQuestion = (index: number) => {
    setActiveQuestionIndex(index);
  };

  const addNewQuestion = (type: FormQuestionType) => {
    const newQuestion = createDefaultQuestion(generateNewQuestionClientSideId(), type);
    appendQuestion(newQuestion);
    setActiveQuestionIndex(questionFields.length);
  };
  
  const duplicateQuestion = (index: number) => {
    const questionToDuplicate = formMethods.getValues(`questions.${index}`);
    if (questionToDuplicate) {
      const newQuestion = {
        ...questionToDuplicate,
        id: generateNewQuestionClientSideId(),
      };
      appendQuestion(newQuestion as ClientFormQuestion);
      setActiveQuestionIndex(questionFields.length);
    }
  };

  const openCreateFormDialogCustom = () => {
    openCreateFormDialog();
    setActiveQuestionIndex(0);
    setIsFormDialogOpen(true);
  };

  const openEditFormDialogCustom = (form: FormListItem) => {
    openEditFormDialog(form);
    if (formMethods.getValues("questions").length > 0) {
        setActiveQuestionIndex(0);
    } else {
        setActiveQuestionIndex(null);
    }
    setIsFormDialogOpen(true);
  };

  const handleQuestionTypeChange = (
    index: number,
    newType: FormQuestionType,
    setValue: UseFormSetValue<FormValues> 
  ) => {
    const currentQuestion = formMethods.getValues(`questions.${index}`);
    const newQuestionData = createDefaultQuestion(currentQuestion?.id ?? generateNewQuestionClientSideId(), newType);
    
    if (currentQuestion?.text) {
        newQuestionData.text = currentQuestion.text;
    }
    setValue(`questions.${index}`, newQuestionData, { shouldValidate: true, shouldDirty: true });
  };

  if (formsQuery.isLoading || categoriesQuery.isLoading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading forms data...</p></div>;
  }

  if (formsQuery.isError || categoriesQuery.isError) {
    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader className="text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
                <CardTitle>Error Loading Data</CardTitle>
                <CardDescription>
                {formsQuery.error?.message ?? categoriesQuery.error?.message ?? "There was a problem fetching forms or categories."}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
                <Button onClick={() => { void formsQuery.refetch(); void categoriesQuery.refetch(); }}>Retry</Button>
            </CardContent>
        </Card>
    );
  }

  const forms = formsQuery.data?.items ?? [];
  const categories = categoriesQuery.data ?? [];

  return (
    <div className="space-y-6">
        <div className="flex justify-end">
            <Button onClick={openCreateFormDialogCustom}>
            <PlusCircle className="mr-2 h-4 w-4" /> Create New Form
            </Button>
        </div>

        <Dialog open={isFormDialogOpen} onOpenChange={setIsFormDialogOpen}>
            <DialogContent className="w-full max-w-2xl mx-auto p-0">
                <DialogHeader>
                    <DialogTitle>{editingForm ? "Edit Form" : "Create New Form"}</DialogTitle>
                    <DialogDescription>
                        {editingForm ? "Modify the details of this form." : "Fill in the details to create a new form."}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={formMethods.handleSubmit(onSubmit)} className="space-y-4 w-full">
                <ScrollArea className="h-[60vh] w-full p-4 border rounded-md overflow-x-hidden">
                    <div className="space-y-4 w-full max-w-2xl mx-auto">
                        <div>
                            <Label htmlFor="title">Title</Label>
                            <Input id="title" {...formMethods.register("title")} />
                            {formMethods.formState.errors.title && <p className="text-sm text-destructive mt-1">{formMethods.formState.errors.title.message}</p>}
                        </div>
                        <div>
                            <Label htmlFor="description">Description (Optional)</Label>
                            <Textarea id="description" {...formMethods.register("description")} maxLength={1000} />
                        </div>
                        <div>
                          <Label htmlFor="categoryId">Category (Optional)</Label>
                          <Controller
                              name="categoryId"
                              control={formMethods.control}
                              render={({ field }) => (
                                <Select onValueChange={(value) => field.onChange(value ? Number(value) : null)} value={field.value?.toString() ?? ""}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a category..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__NO_CATEGORY__" disabled>No Category (placeholder)</SelectItem>
                                        {categories.map(cat => (
                                            <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                              )}
                            />
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle>Questions</CardTitle>
                                <CardDescription>Add and configure questions for this form.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {questionFields.map((item, index) => {
                                  const isEditingThisQuestion = activeQuestionIndex === index;
                                  const questionTextPath = `questions.${index}.text` as const;
                                  const questionTypePath = `questions.${index}.type` as const;
                                  const questionOptionsPath = `questions.${index}.options` as const;
                                  const questionAllowMultiplePath = `questions.${index}.allowMultiple` as const;
                                  const questionMaxLengthPath = `questions.${index}.maxLength` as const;
                                  const questionSupportsMarkdownPath = `questions.${index}.supportsMarkdown` as const;

                                  const currentQuestionWatched = formMethods.watch(`questions.${index}` as const);
                                  const errors = formMethods.formState.errors.questions?.[index] as FieldErrors<ClientFormQuestion> | undefined;
                                  
                                  return (
                                    <Card 
                                        key={item.id} 
                                        className={`p-4 border rounded-lg shadow-sm transition-all duration-200 ease-in-out w-full break-words ${isEditingThisQuestion ? 'bg-background ring-2 ring-primary' : 'bg-muted/30 hover:bg-muted/50'}`}
                                        onClick={() => !isEditingThisQuestion && editQuestion(index)}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="flex-grow space-y-1">
                                                {!isEditingThisQuestion ? (
                                                    <div className="flex justify-between items-center cursor-pointer">
                                                        <p className="font-medium break-all whitespace-pre-line pr-2" style={{ overflowWrap: 'anywhere' }}>
                                                            {index + 1}. {currentQuestionWatched?.text || <span className="italic text-muted-foreground">Untitled Question</span>}
                                                        </p>
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant="outline" className="text-xs">{QuestionTypeLabels[currentQuestionWatched?.type ?? 'short_answer']}</Badge>
                                                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3">
                                                        <div className="flex justify-between items-center mb-2">
                                                            <p className="font-medium text-primary">{index + 1}. Editing Question</p>
                                                            <ChevronUp className="h-4 w-4 text-primary cursor-pointer" onClick={() => setActiveQuestionIndex(null)} />
                                                        </div>
                                                        <div>
                                                            <Label htmlFor={questionTextPath}>Question Text</Label>
                                                            <Input id={questionTextPath} {...formMethods.register(questionTextPath)} autoFocus />
                                                            {errors?.text && <p className="text-sm text-destructive mt-1">{errors.text.message}</p>}
                                                        </div>
                                                        
                                                        <div className="w-full sm:w-2/3">
                                                            <Label htmlFor={questionTypePath}>Type</Label>
                                                            <Controller
                                                                name={questionTypePath}
                                                                control={formMethods.control}
                                                                render={({ field: typeField }) => (
                                                                    <Select 
                                                                        onValueChange={(newTypeValue: "true_false" | "multiple_choice" | "short_answer" | "long_answer") => handleQuestionTypeChange(index, newTypeValue, formMethods.setValue)}
                                                                        value={typeField.value}
                                                                    >
                                                                        <SelectTrigger><SelectValue placeholder="Select question type" /></SelectTrigger>
                                                                        <SelectContent>
                                                                        {Object.entries(QuestionTypeLabels).map(([typeVal, typeLabel]) => (
                                                                            <SelectItem key={typeVal} value={typeVal}>{typeLabel}</SelectItem>
                                                                        ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                )}
                                                            />
                                                        </div>

                                                        {currentQuestionWatched?.type === 'multiple_choice' && currentQuestionWatched && 'options' in currentQuestionWatched && (
                                                            <div className="space-y-2 pt-2">
                                                                <Label className="text-sm">Options <span className="text-xs text-muted-foreground">(Min. 2, one per line)</span></Label>
                                                                <Controller
                                                                    name={questionOptionsPath}
                                                                    control={formMethods.control}
                                                                    render={({ field: optionsField }) => {
                                                                        const currentOptions = (optionsField.value as string[] | undefined) ?? [];
                                                                        return (
                                                                            <Textarea 
                                                                                placeholder="Option 1\nOption 2"
                                                                                value={currentOptions.join('\n')}
                                                                                onChange={(e) => optionsField.onChange(e.target.value.split('\n'))}
                                                                                className="text-sm h-24"
                                                                                rows={Math.max(2, currentOptions.length)}
                                                                            />
                                                                        );
                                                                    }}
                                                                />
                                                                {(errors as FieldErrors<Extract<ClientFormQuestion, {type: 'multiple_choice'}>>)?.options && 
                                                                    <p className="text-sm text-destructive mt-1">
                                                                        {(errors as FieldErrors<Extract<ClientFormQuestion, {type: 'multiple_choice'}>>)?.options?.message ?? 
                                                                         (Array.isArray((errors as FieldErrors<Extract<ClientFormQuestion, {type: 'multiple_choice'}>>)?.options) && 
                                                                          ((errors as FieldErrors<Extract<ClientFormQuestion, {type: 'multiple_choice'}>>)?.options?.[0]?.message))}
                                                                    </p>
                                                                }
                                                                <div className="flex items-center space-x-2 pt-1">
                                                                    <Controller 
                                                                        name={questionAllowMultiplePath} 
                                                                        control={formMethods.control} 
                                                                        render={({ field: amField }) => <Checkbox id={questionAllowMultiplePath} checked={!!amField.value} onCheckedChange={amField.onChange} />} />
                                                                    <Label htmlFor={questionAllowMultiplePath} className="text-xs font-normal">Allow Multiple Selections</Label>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {(currentQuestionWatched?.type === 'short_answer' || currentQuestionWatched?.type === 'long_answer') && currentQuestionWatched && 'maxLength' in currentQuestionWatched && (
                                                            <div className="w-full sm:w-1/2 pt-2">
                                                                <Label htmlFor={questionMaxLengthPath} className="text-sm">Max Length (Optional)</Label>
                                                                <Input type="number" min="1" step="1" id={questionMaxLengthPath} {...formMethods.register(questionMaxLengthPath, { setValueAs: (v) => v === '' || v == null ? undefined : (Number.isNaN(Number(v)) ? undefined : (parseInt(String(v),10) > 0 ? parseInt(String(v),10) : undefined))})} className="text-sm h-9" />
                                                                 {(errors as FieldErrors<Extract<ClientFormQuestion, { type: 'short_answer' | 'long_answer' }>>)?.maxLength && <p className="text-sm text-destructive mt-1">{(errors as FieldErrors<Extract<ClientFormQuestion, { type: 'short_answer' | 'long_answer' }>>)?.maxLength?.message}</p>}
                                                            </div>
                                                        )}
                                                        {currentQuestionWatched?.type === 'long_answer' && currentQuestionWatched && 'supportsMarkdown' in currentQuestionWatched && (
                                                            <div className="flex items-center space-x-2 pt-2">
                                                                <Controller 
                                                                    name={questionSupportsMarkdownPath} 
                                                                    control={formMethods.control} 
                                                                    render={({ field: smField }) => <Checkbox id={questionSupportsMarkdownPath} checked={!!smField.value} onCheckedChange={smField.onChange} />} />
                                                                <Label htmlFor={questionSupportsMarkdownPath} className="text-xs font-normal">Supports Markdown</Label>
                                                            </div>
                                                        )}

                                                        <div className="flex items-center justify-end gap-2 pt-3 border-t mt-3">
                                                            <Button type="button" variant="outline" size="sm" onClick={() => duplicateQuestion(index)}>Duplicate</Button>
                                                            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeQuestion(index)} disabled={questionFields.length <= 1}>Delete</Button>
                                                            <Button type="button" variant="default" size="sm" onClick={() => setActiveQuestionIndex(null)}>Done</Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </Card>
                                  )}
                                )}
                            </CardContent>
                            <CardFooter className="flex justify-center border-t pt-4 mt-4">
                                <div className="flex gap-2 flex-wrap justify-center">
                                    {Object.entries(QuestionTypeLabels).map(([type, label]) => (
                                        <Button key={type} type="button" variant="outline" size="sm" onClick={() => addNewQuestion(type as FormQuestionType)} className="text-xs">
                                            <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Add {label}
                                        </Button>
                                    ))}
                                </div>
                            </CardFooter>
                        </Card>

                        <Card>
                            <CardHeader><CardTitle className="text-base">Access & Workflow</CardTitle></CardHeader>
                            <CardContent className="space-y-3">
                                <div>
                                    <Label htmlFor="accessRoleIds">Access Roles (Discord Role IDs)</Label>
                                    <Controller
                                        name="accessRoleIds"
                                        control={formMethods.control}
                                        render={({ field }) => (
                                            <RoleIdTagInput
                                                value={field.value ?? []}
                                                onChange={field.onChange}
                                                placeholder="Type a role ID and press Enter or comma"
                                            />
                                        )}
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">Only users with these roles can submit. Leave empty for all.</p>
                                </div>
                                <div>
                                    <Label htmlFor="reviewerRoleIds">Reviewer Roles (Discord Role IDs)</Label>
                                    <Controller
                                        name="reviewerRoleIds"
                                        control={formMethods.control}
                                        render={({ field }) => (
                                            <RoleIdTagInput
                                                value={field.value ?? []}
                                                onChange={field.onChange}
                                                placeholder="Type a role ID and press Enter or comma"
                                            />
                                        )}
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">Users with these roles can review submissions.</p>
                                </div>
                                <div>
                                    <Label htmlFor="finalApproverRoleIds">Final Approver Roles (Discord Role IDs)</Label>
                                    <Controller
                                        name="finalApproverRoleIds"
                                        control={formMethods.control}
                                        render={({ field }) => (
                                            <RoleIdTagInput
                                                value={field.value ?? []}
                                                onChange={field.onChange}
                                                placeholder="Type a role ID and press Enter or comma"
                                            />
                                        )}
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">Users who can give final approval (if required).</p>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <div className="flex-1">
                                        <Label htmlFor="requiredReviewers">Required Reviewers</Label>
                                        <Input id="requiredReviewers" type="number" min="0" {...formMethods.register("requiredReviewers", { valueAsNumber: true })} />
                                        <p className="text-xs text-muted-foreground mt-1">Number of reviews needed. 0 means no reviews before approval, or auto-approved if final approval also not required.</p>
                                    </div>
                                    <div className="flex items-center space-x-2 pt-6">
                                        <Controller name="requiresFinalApproval" control={formMethods.control} render={({field}) => <Checkbox id="requiresFinalApproval" checked={field.value} onCheckedChange={field.onChange} />} />
                                        <Label htmlFor="requiresFinalApproval">Requires Final Approval</Label>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </ScrollArea>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button 
                        type="submit" 
                        disabled={createFormMutation.isPending || editFormMutation.isPending || (formMethods.formState.isSubmitted && !formMethods.formState.isValid)}
                    >
                        {(createFormMutation.isPending || editFormMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {editingForm ? "Save Changes" : "Create Form"}
                    </Button>
                </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>

        <Dialog open={!!formToDelete} onOpenChange={(isOpen) => !isOpen && setFormToDelete(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete Form: {formToDelete?.title}</DialogTitle>
                    <DialogDescription>
                        Are you sure you want to delete this form? This is a soft delete. Submitted responses will NOT be deleted.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setFormToDelete(null)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDeleteForm} disabled={deleteFormMutation.isPending}>
                        {deleteFormMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete Form
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {forms.length === 0 ? (
            <div className="text-center py-10 border border-dashed rounded-lg">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-2 text-sm font-medium">No forms found</h3>
                <p className="mt-1 text-sm text-muted-foreground">Get started by creating a new form.</p>
            </div>
        ) : (
            <Card>
                <CardHeader>
                    <CardTitle>Existing Forms</CardTitle>
                    <CardDescription>Manage all your forms here. Click on a form to edit it.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[500px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Title</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead>Questions</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {forms.map((form: FormListItem) => (
                                    <TableRow key={form.id}>
                                        <TableCell className="font-medium">{form.title}</TableCell>
                                        <TableCell>{categories.find(c => c.id === form.categoryId)?.name ?? "-"}</TableCell>
                                        <TableCell>{(form.questions as ServerFormQuestionDefinition[] | undefined)?.length ?? 0}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => openEditFormDialogCustom(form)} className="mr-1">
                                                <Edit3 className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setFormToDelete(form)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
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