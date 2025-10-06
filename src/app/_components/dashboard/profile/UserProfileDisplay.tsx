"use client";

import React from 'react';
import { type RouterOutputs } from "@/trpc/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type UserProfile = RouterOutputs["user"]["getMe"];

interface UserProfileDisplayProps {
  user: UserProfile;
}

const updateTsUidSchema = z.object({
  ts_uid: z.string().min(1, "TeamSpeak UID cannot be empty").max(28, "TeamSpeak UID too long (max 28 characters)"),
});

type UpdateTsUidFormValues = z.infer<typeof updateTsUidSchema>;

const UserProfileDisplay: React.FC<UserProfileDisplayProps> = ({ user }) => {
  const utils = api.useUtils();
  const updateTsUidMutation = api.user.updateMyTsUid.useMutation({
    onSuccess: async () => {
      toast.success("TeamSpeak UID updated successfully.");
      await utils.user.getMe.invalidate();
    },
    onError: (error) => {
      let errorMessage = "Failed to update TeamSpeak UID.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      toast.error(errorMessage);
    },
  });

  // NEW: TeamSpeak sync mutation
  const syncTeamSpeakMutation = api.user.syncTeamSpeak.useMutation({
    onSuccess: (data) => {
      toast.success(data?.message ?? "TeamSpeak sync initiated successfully!");
    },
    onError: (error) => {
      toast.error(error.message ?? "Failed to sync TeamSpeak. Please try again.");
    },
  });

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<UpdateTsUidFormValues>({
    resolver: zodResolver(updateTsUidSchema),
    defaultValues: {
      ts_uid: user?.ts_uid ?? '',
    },
  });

  const onSubmit = (data: UpdateTsUidFormValues) => {
    updateTsUidMutation.mutate({ ts_uid: data.ts_uid });
  };

  if (!user) {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Profile Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No profile data found.</p>
        </CardContent>
      </Card>
    );
  }

  const profileItems = [
    { label: "Username", value: user.username },
    { label: "Discord ID", value: user.discordId },
    { label: "Role", value: user.is_admin ? "Admin" : user.is_moderator ? "Moderator" : "User" },
    { label: "API Key", value: user.api_key, isSensitive: true },
    { label: "Last Synced", value: new Date(user.last_synced).toLocaleString() },
  ];

  return (
    <div className="space-y-8">
      {/* Degraded banner */}
      {(user as any)?.degraded && (
        <Alert className="border-yellow-300 bg-yellow-50 text-yellow-900">
          <AlertTitle>Partial data shown</AlertTitle>
          <AlertDescription>
            Some external services are temporarily unavailable. Displaying cached profile data; actions may be limited.
          </AlertDescription>
        </Alert>
      )}

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Account Information</CardTitle>
          <CardDescription>View and manage your account details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {profileItems.map((item) => (
            <div key={item.label} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b pb-3 last:border-b-0 last:pb-0">
              <p className="font-medium text-foreground/90">{item.label}</p>
              {item.isSensitive ? (
                <Badge variant="outline" className="mt-1 sm:mt-0 font-mono text-xs select-all">**********</Badge>
              ) : (
                <p className="text-muted-foreground mt-1 sm:mt-0">{String(item.value)}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl">TeamSpeak Configuration</CardTitle>
          <CardDescription>Update your TeamSpeak Unique ID (UID) and sync your groups.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="ts_uid" className="block text-sm font-medium text-foreground/90 mb-1">TeamSpeak UID</label>
              <Controller
                name="ts_uid"
                control={control}
                render={({ field }) => (
                  <Input 
                    {...field} 
                    id="ts_uid"
                    placeholder="Enter your TeamSpeak UID"
                    className={errors.ts_uid ? "border-destructive" : ""}
                  />
                )}
              />
              {errors.ts_uid && (
                <p className="mt-1 text-sm text-destructive">{errors.ts_uid.message}</p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button type="submit" disabled={isSubmitting || updateTsUidMutation.isPending} className="w-full sm:w-auto">
                {isSubmitting || updateTsUidMutation.isPending ? (
                  <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Updating...</>
                ) : (
                  "Update TeamSpeak UID"
                )}
              </Button>
              <Button 
                type="button"
                variant="outline"
                onClick={() => syncTeamSpeakMutation.mutate()}
                disabled={!user?.ts_uid || syncTeamSpeakMutation.isPending}
                className="w-full sm:w-auto"
              >
                {syncTeamSpeakMutation.isPending ? (
                  <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Syncing...</>
                ) : (
                  <><RefreshCw className="mr-2 h-4 w-4" /> Sync TeamSpeak Now</>
                )}
              </Button>
            </div>
            {!user?.ts_uid && (
              <p className="text-sm text-muted-foreground">
                💡 You must set your TeamSpeak UID before you can sync your groups.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default UserProfileDisplay; 