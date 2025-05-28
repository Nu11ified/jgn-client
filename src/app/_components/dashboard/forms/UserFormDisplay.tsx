"use client";

import React, { useEffect, useState } from 'react';
import { useForm, Controller, useFieldArray, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, type RouterOutputs } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, Save, Send, ArrowLeft, Info } from 'lucide-react';
import { toast } from "sonner";
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { FormQuestionType } from '@/app/_components/admin/forms/FormsAdmin';

// Types from server schema
type ServerFormQuestion = RouterOutputs["form"]["getFormById"]["questions"][number];
type ServerFormAnswer = RouterOutputs["form"]["submitResponse"]["answers"][number];

// Define enum values for z.enum, corresponding to FormQuestionType
const formQuestionEnumValues = ["true_false", "multiple_choice", "short_answer", "long_answer"] as const;

// Client-side representation for answers, mapping to ServerFormAnswer structure on submit
const clientAnswerSchema = z.object({
  questionId: z.string(),
  type: z.enum(formQuestionEnumValues), // Use z.enum with explicit values
  answer: z.any(), // Specific validation per type will be in the main schema
});
export type ClientAnswer = z.infer<typeof clientAnswerSchema>;

const formSubmissionSchema = z.object({
  answers: z.array(clientAnswerSchema).min(1, "At least one answer is required, or the form is empty."),
});
export type FormSubmissionValues = z.infer<typeof formSubmissionSchema>;

interface UserFormDisplayProps {
  formId: number;
  responseIdToEdit?: number; // For editing drafts
}

// Add these utility functions at the top level
const SUBMIT_COOLDOWN_MS = 30000; // 30 seconds between submissions
const MAX_SUBMISSIONS_PER_HOUR = 10;
const TYPING_SPEED_THRESHOLD_MS = 50; // Minimum time between keypresses for natural typing

const getSubmissionHistory = () => {
  try {
    return JSON.parse(localStorage.getItem('form_submissions') ?? '[]') as number[];
  } catch {
    return [];
  }
};

const addSubmissionTimestamp = () => {
  const now = Date.now();
  const history = getSubmissionHistory();
  const newHistory = [...history, now].filter(time => time > now - 3600000); // Keep last hour
  localStorage.setItem('form_submissions', JSON.stringify(newHistory));
};

const canSubmit = () => {
  const history = getSubmissionHistory();
  const now = Date.now();
  const hourAgo = now - 3600000;
  
  // Clean old entries and count submissions in last hour
  const recentSubmissions = history.filter(time => time > hourAgo);
  
  // Check if enough time has passed since last submission
  const lastSubmission = recentSubmissions[recentSubmissions.length - 1] ?? 0;
  const timeSinceLastSubmission = now - lastSubmission;
  
  return recentSubmissions.length < MAX_SUBMISSIONS_PER_HOUR && 
         timeSinceLastSubmission > SUBMIT_COOLDOWN_MS;
};

export default function UserFormDisplay({ formId, responseIdToEdit }: UserFormDisplayProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: formData, isLoading: isLoadingForm, error: formError } = api.form.getFormById.useQuery(
    { id: formId }, 
    { refetchOnWindowFocus: false, enabled: !isNaN(formId) }
  );

  const { data: draftData, isLoading: isLoadingDraft, error: draftError } = api.form.getUserDraft.useQuery(
    { formId }, 
    { refetchOnWindowFocus: false, enabled: !!responseIdToEdit && !isNaN(formId) } // Only if responseIdToEdit is present
  );

  const utils = api.useUtils();
  const submitMutation = api.form.submitResponse.useMutation({
    onSuccess: () => {
      toast.success("Form submitted successfully!");
      void utils.form.listUserSubmissions.invalidate(); // To refresh the filled forms list
      router.push("/dashboard/form?tab=filled"); // Navigate to filled forms tab
    },
    onError: (error) => toast.error(`Submission failed: ${error.message}`),
  });

  const saveDraftMutation = api.form.saveDraft.useMutation({
    onSuccess: (data) => {
      toast.success("Draft saved successfully!");
      // If it was a new draft, router might need responseId if we want to stay on the page
      // For now, let's assume it stays, and if responseIdToEdit was undefined, it's now populated by `data.id`
      // This might require a redirect or state update if we want to seamlessly switch to editing the new draft.
      if (!responseIdToEdit && data.id) {
        const currentQuery = new URLSearchParams(Array.from(searchParams.entries()));
        currentQuery.set("responseId", data.id.toString());
        router.replace(`${pathname}?${currentQuery.toString()}`);
      }
      void utils.form.listUserSubmissions.invalidate(); // Refresh drafts in UserFilledForms
      void utils.form.getUserDraft.invalidate({ formId }); // Refresh current draft if editing
    },
    onError: (error) => toast.error(`Failed to save draft: ${error.message}`),
  });

  const { control, handleSubmit, reset, setValue, formState: { errors, isSubmitting, isDirty } } = useForm<FormSubmissionValues>({
    resolver: zodResolver(formSubmissionSchema),
    defaultValues: { answers: [] },
  });

  const { fields, append, replace } = useFieldArray({ control, name: "answers" });

  const [lastKeypressTime, setLastKeypressTime] = useState<number>(0);
  const [typingTooFast, setTypingTooFast] = useState(false);
  const [honeypotValue, setHoneypotValue] = useState('');

  useEffect(() => {
    if (formData?.questions) {
      let initialAnswers: ClientAnswer[] = [];
      if (responseIdToEdit && draftData?.answers) {
        initialAnswers = formData.questions.map(q => {
          const draftAns = draftData.answers.find(da => da.questionId === q.id.toString());
          let parsedAnswer: string | boolean | string[] | undefined;
          if (draftAns) {
            try {
              if (q.type === "true_false") {
                // Handles boolean true/false or string "true"/"false"
                const val = draftAns.answer;
                parsedAnswer = typeof val === 'boolean' ? val : String(val).toLowerCase() === 'true';
              } else if (q.type === "multiple_choice") {
                const val = draftAns.answer;
                if (typeof val === 'string') {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  const parsedJson = JSON.parse(val);
                  parsedAnswer = Array.isArray(parsedJson) ? parsedJson.map(String) : [];
                } else if (Array.isArray(val)) {
                  parsedAnswer = val.map(String); // Ensure all elements are strings
                } else {
                  parsedAnswer = []; // Default to empty array if unexpected type
                }
              } else { // short_answer, long_answer
                parsedAnswer = String(draftAns.answer ?? "");
              }
            } catch (error) {
              console.error("Error parsing draft answer:", error, "Question:", q.text, "Answer:", draftAns.answer);
              parsedAnswer = getDefaultAnswerForType(q.type);
            }
          } else {
            parsedAnswer = getDefaultAnswerForType(q.type);
          }
          return {
            questionId: q.id.toString(),
            type: q.type,
            answer: parsedAnswer, // This should now be fine as ClientAnswer['answer'] is z.any()
          };
        });
      } else {
        initialAnswers = formData.questions.map(q => ({
          questionId: q.id.toString(),
          type: q.type,
          answer: getDefaultAnswerForType(q.type),
        }));
      }
      replace(initialAnswers);
    }
  }, [formData, draftData, responseIdToEdit, replace]);

  const getDefaultAnswerForType = (type: FormQuestionType) => {
    switch (type) {
      case "true_false": return false; // Default to false or null
      case "multiple_choice": return []; // Empty array for multiple selections
      case "short_answer":
      case "long_answer": return "";
      default: return undefined;
    }
  };

  const onSubmit: SubmitHandler<FormSubmissionValues> = (data) => {
    // Check for spam indicators
    if (honeypotValue || typingTooFast || !canSubmit()) {
      toast.error("Please wait a moment before submitting again.");
      return;
    }

    const answersForApi = data.answers.map(ans => {
      let finalAnswer: string | boolean | string[];
      if (ans.type === "true_false") {
        finalAnswer = typeof ans.answer === 'boolean' ? ans.answer : String(ans.answer).toLowerCase() === 'true';
      } else if (ans.type === "multiple_choice") {
        finalAnswer = Array.isArray(ans.answer) ? ans.answer.map(String) : [];
      } else { // short_answer, long_answer
        finalAnswer = String(ans.answer ?? "");
      }
      return {
        questionId: ans.questionId,
        type: ans.type,
        answer: finalAnswer,
      };
    }) as ServerFormAnswer[];

    addSubmissionTimestamp();
    submitMutation.mutate({ formId, answers: answersForApi });
  };

  const handleSaveDraft = async () => {
    const currentValues = control._getWatch() as FormSubmissionValues;
    if (currentValues.answers) {
        const answersForApi = currentValues.answers.map(ans => {
            let finalAnswer: string | boolean | string[];
            if (ans.type === "true_false") {
                finalAnswer = typeof ans.answer === 'boolean' ? ans.answer : String(ans.answer).toLowerCase() === 'true';
            } else if (ans.type === "multiple_choice") {
                finalAnswer = Array.isArray(ans.answer) ? ans.answer.map(String) : [];
            } else { // short_answer, long_answer
                finalAnswer = String(ans.answer ?? "");
            }
            return {
                questionId: ans.questionId,
                type: ans.type,
                answer: finalAnswer,
            };
        }) as ServerFormAnswer[];
        saveDraftMutation.mutate({ formId, answers: answersForApi, responseId: responseIdToEdit });
    }
  };

  // Add keypress monitoring for text inputs
  const handleKeyPress = () => {
    const now = Date.now();
    if (lastKeypressTime && (now - lastKeypressTime) < TYPING_SPEED_THRESHOLD_MS) {
      setTypingTooFast(true);
    }
    setLastKeypressTime(now);
  };

  // Reset typing speed flag after a delay
  useEffect(() => {
    if (typingTooFast) {
      const timer = setTimeout(() => setTypingTooFast(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [typingTooFast]);

  if (isLoadingForm || (responseIdToEdit && isLoadingDraft)) {
    return (
      <div className="container mx-auto py-8 flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading form data...</p>
      </div>
    );
  }

  if (formError) {
    return <div className="container mx-auto py-8 text-center text-destructive">Error loading form: {formError.message}</div>;
  }
  if (responseIdToEdit && draftError) {
    return <div className="container mx-auto py-8 text-center text-destructive">Error loading draft: {draftError.message}</div>;
  }
  if (!formData) {
    return <div className="container mx-auto py-8 text-center text-muted-foreground">Form not found.</div>;
  }

  const renderQuestion = (question: ServerFormQuestion, index: number) => {
    const fieldName = `answers.${index}.answer` as const;
    const questionIdStr = question.id.toString();

    return (
      <Card key={question.id} className="mb-6 bg-card/70">
        <CardHeader>
          <CardTitle className="text-lg">{question.text}</CardTitle>
          {/* <CardDescription>Question type: {question.type}</CardDescription> */}
        </CardHeader>
        <CardContent>
          {question.type === "true_false" && (
            <Controller
              name={fieldName}
              control={control}
              render={({ field }) => (
                <RadioGroup 
                    onValueChange={(val) => field.onChange(val === 'true')} 
                    value={field.value === true ? 'true' : field.value === false ? 'false' : ''} 
                    className="flex space-x-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="true" id={`${questionIdStr}-true`} />
                    <Label htmlFor={`${questionIdStr}-true`}>True</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="false" id={`${questionIdStr}-false`} />
                    <Label htmlFor={`${questionIdStr}-false`}>False</Label>
                  </div>
                </RadioGroup>
              )}
            />
          )}
          {question.type === "short_answer" && (
            <Controller
              name={fieldName}
              control={control}
              render={({ field }) => (
                <Input 
                  {...field} 
                  value={String(field.value ?? "")} 
                  placeholder="Your answer" 
                  maxLength={question.maxLength ?? undefined}
                  onKeyPress={handleKeyPress}
                />
              )}
            />
          )}
          {question.type === "long_answer" && (
            <Controller
              name={fieldName}
              control={control}
              render={({ field }) => (
                <Textarea 
                  {...field} 
                  value={String(field.value ?? "")} 
                  placeholder="Your detailed answer" 
                  rows={5} 
                  maxLength={question.maxLength ?? undefined}
                  onKeyPress={handleKeyPress}
                />
              )}
            />
          )}
          {question.type === "multiple_choice" && (
            <Controller
              name={fieldName}
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  {question.options?.map((option: string, optIndex: number) => (
                    <div key={optIndex} className="flex items-center space-x-2">
                      <Checkbox 
                        id={`${questionIdStr}-opt-${optIndex}`}
                        checked={question.allowMultiple ? (Array.isArray(field.value) && (field.value as string[]).includes(option)) : field.value === option}
                        onCheckedChange={(checked) => {
                          if (question.allowMultiple) {
                            const currentVal = Array.isArray(field.value) ? field.value as string[] : [];
                            if (checked) {
                              field.onChange([...currentVal, option]);
                            } else {
                              field.onChange(currentVal.filter((item: string) => item !== option));
                            }
                          } else {
                            field.onChange(checked ? option : undefined);
                          }
                        }}
                      />
                      <Label htmlFor={`${questionIdStr}-opt-${optIndex}`} className="font-normal">{option}</Label>
                    </div>
                  ))}
                </div>
              )}
            />
          )}
           {errors.answers?.[index]?.answer?.message && (
            <p className="text-sm text-destructive mt-1">{errors.answers[index]?.answer?.message as string}</p>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto py-10 px-4 sm:px-6 lg:px-8 max-w-3xl">
      <Card className="shadow-xl border-border/50">
        <CardHeader className="border-b pb-6">
          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" asChild className="mb-4">
                <Link href="/dashboard/form"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Forms</Link>
            </Button>
          </div> 
          <CardTitle className="text-3xl font-bold tracking-tight">{formData.title}</CardTitle>
          {formData.description && <CardDescription className="mt-2 text-lg text-muted-foreground whitespace-pre-line">{formData.description}</CardDescription>}
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Honeypot field - hidden from real users */}
          <input
            type="text"
            name="website"
            value={honeypotValue}
            onChange={(e) => setHoneypotValue(e.target.value)}
            autoComplete="off"
            style={{ display: 'none' }}
            tabIndex={-1}
            aria-hidden="true"
          />
          <CardContent className="pt-8 space-y-6">
            {formData.questions.map((q, index) => renderQuestion(q, index))}
             {formData.questions.length === 0 && (
                <div className="text-center py-10 text-muted-foreground">
                    <Info className="mx-auto h-12 w-12 mb-3" />
                    <p className="text-lg">This form currently has no questions.</p>
                </div>
            )}
          </CardContent>
          {formData.questions.length > 0 && (
            <CardFooter className="flex flex-col sm:flex-row justify-end gap-3 pt-8 border-t">
                <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isSubmitting || saveDraftMutation.isPending}>
                {saveDraftMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save Draft
                </Button>
                <Button type="submit" disabled={isSubmitting || saveDraftMutation.isPending} className="w-full sm:w-auto">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Submit Form
                </Button>
            </CardFooter>
          )}
        </form>
      </Card>
    </div>
  );
} 