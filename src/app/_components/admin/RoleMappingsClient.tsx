"use client";

import React, { useState, useMemo } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
// import { type RouterOutputs } from "@/trpc/shared"; // Commented out shared import
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input"; // Though not strictly needed for IDs, might be for future filters
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Edit, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

// Infer element types from procedure outputs
type RoleMappingOutput = RouterOutputs["admin"]["roleMappings"]["listRoleMappings"];
type RoleMapping = RoleMappingOutput extends (infer T)[] | undefined ? T : never;

type DiscordRoleOutput = RouterOutputs["admin"]["roles"]["listRoles"];
type DiscordRole = DiscordRoleOutput extends (infer T)[] | undefined ? T : never;

type TsGroupOutput = RouterOutputs["admin"]["teamSpeakGroups"]["listTsGroups"];
type TsGroup = TsGroupOutput extends (infer T)[] | undefined ? T : never;

interface RoleMappingsClientProps {
  initialRoleMappings: RoleMapping[] | null;
  initialDiscordRoles: DiscordRole[] | null;
  initialTsGroups: TsGroup[] | null;
}

const roleMappingSchema = z.object({
  discord_role_id: z.string().min(1, "Discord Role is required."),
  teamspeak_sgid: z.string().min(1, "TeamSpeak Group is required."),
});

type RoleMappingFormValues = z.infer<typeof roleMappingSchema>;

export default function RoleMappingsClient({
  initialRoleMappings,
  initialDiscordRoles,
  initialTsGroups,
}: RoleMappingsClientProps) {
  const utils = api.useUtils();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<RoleMapping | null>(null);

  const { data: roleMappingsData, isLoading: isLoadingMappings, error: mappingsError } = api.admin.roleMappings.listRoleMappings.useQuery(
    { limit: 50 }, 
    { initialData: initialRoleMappings ?? undefined, refetchOnWindowFocus: false, enabled: !!initialRoleMappings }
  );
  const roleMappings = roleMappingsData ?? initialRoleMappings;

  const { data: discordRolesData, isLoading: isLoadingDiscordRoles, error: discordRolesError } = api.admin.roles.listRoles.useQuery(
    { limit: 200 }, 
    { initialData: initialDiscordRoles ?? undefined, refetchOnWindowFocus: false, enabled: !!initialDiscordRoles }
  );
  const discordRoles = discordRolesData ?? initialDiscordRoles;

  const { data: tsGroupsData, isLoading: isLoadingTsGroups, error: tsGroupsError } = api.admin.teamSpeakGroups.listTsGroups.useQuery(
    { limit: 200 }, 
    { initialData: initialTsGroups ?? undefined, refetchOnWindowFocus: false, enabled: !!initialTsGroups }
  );
  const tsGroups = tsGroupsData ?? initialTsGroups;

  const uniqueDiscordRoles = useMemo(() => {
    if (!discordRoles) return [];
    const seenIds = new Set<string>();
    return discordRoles.filter(role => {
      if (role?.role_id == null) return false;
      if (seenIds.has(role.role_id)) {
        return false;
      }
      seenIds.add(role.role_id);
      return true;
    });
  }, [discordRoles]);

  const uniqueTsGroups = useMemo(() => {
    if (!tsGroups) return [];
    const seenIds = new Set<number>();
    return tsGroups.filter((group: TsGroup) => {
      if (group?.sgid == null) return false;
      if (seenIds.has(group.sgid)) {
        return false;
      }
      seenIds.add(group.sgid);
      return true;
    });
  }, [tsGroups]);

  const discordRolesMap = useMemo(() => 
    discordRoles?.reduce((acc: Record<string, string>, role: DiscordRole) => {
      if (role?.role_id && role.role_name) acc[role.role_id] = role.role_name;
      return acc;
    }, {} as Record<string, string>) ?? {}
  , [discordRoles]);

  const tsGroupsMap = useMemo(() =>
    tsGroups?.reduce((acc: Record<number, string>, group: TsGroup) => {
      if (group?.sgid && group.name) acc[group.sgid] = group.name;
      return acc;
    }, {} as Record<number, string>) ?? {}
  , [tsGroups]);

  const handleMutationError = (error: unknown, defaultMessage: string) => {
    let message = defaultMessage;
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    }
    toast.error(message);
  };

  const createMutation = api.admin.roleMappings.createRoleMapping.useMutation({
    onSuccess: () => {
      void utils.admin.roleMappings.listRoleMappings.invalidate();
      toast.success("Role mapping created successfully!");
      setIsDialogOpen(false);
    },
    onError: (error) => handleMutationError(error, "Failed to create role mapping."),
  });

  const updateMutation = api.admin.roleMappings.updateRoleMapping.useMutation({
    onSuccess: () => {
      void utils.admin.roleMappings.listRoleMappings.invalidate();
      toast.success("Role mapping updated successfully!");
      setIsDialogOpen(false);
      setEditingMapping(null);
    },
    onError: (error) => handleMutationError(error, "Failed to update role mapping."),
  });

  const deleteMutation = api.admin.roleMappings.deleteRoleMapping.useMutation({
    onSuccess: () => {
      void utils.admin.roleMappings.listRoleMappings.invalidate();
      toast.success("Role mapping deleted successfully!");
    },
    onError: (error) => handleMutationError(error, "Failed to delete role mapping."),
  });

  const { control, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<RoleMappingFormValues>({
    resolver: zodResolver(roleMappingSchema),
    defaultValues: {
      discord_role_id: '',
      teamspeak_sgid: '',
    }
  });

  const handleDialogOpen = (mapping?: RoleMapping | null) => {
    if (mapping) {
      setEditingMapping(mapping);
      setValue("discord_role_id", String(mapping.discord_role_id));
      setValue("teamspeak_sgid", String(mapping.teamspeak_sgid));
    } else {
      setEditingMapping(null);
      reset({ discord_role_id: '', teamspeak_sgid: '' });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = (data: RoleMappingFormValues) => {
    const apiPayload = {
      discord_role_id: data.discord_role_id,
      teamspeak_sgid: Number(data.teamspeak_sgid),
    };
    if (editingMapping) {
      updateMutation.mutate({
        discord_role_id: editingMapping.discord_role_id, 
        teamspeak_sgid: apiPayload.teamspeak_sgid, 
      });
    } else {
      createMutation.mutate(apiPayload);
    }
  };
  
  const initialDataLoading = (!roleMappings && isLoadingMappings) || (!discordRoles && isLoadingDiscordRoles) || (!tsGroups && isLoadingTsGroups);

  if (initialDataLoading && (!initialRoleMappings || !initialDiscordRoles || !initialTsGroups)) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading data...</p>
      </div>
    );
  }

  if ((!roleMappings && mappingsError) || (!discordRoles && discordRolesError) || (!tsGroups && tsGroupsError)) {
    return (
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
          <CardTitle>Error Loading Data</CardTitle>
          <CardDescription>
            There was a problem fetching necessary data. Please try again later.
            {(mappingsError && !roleMappings) && <p className="text-xs mt-1">Role Mappings: {mappingsError.message}</p>}
            {(discordRolesError && !discordRoles) && <p className="text-xs mt-1">Discord Roles: {discordRolesError.message}</p>}
            {(tsGroupsError && !tsGroups) && <p className="text-xs mt-1">TeamSpeak Groups: {tsGroupsError.message}</p>}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  
  return (
    <div className="space-y-6">
      <Card className="shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-2xl">Role Mappings</CardTitle>
            <CardDescription>Manage Discord role to TeamSpeak group mappings.</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { 
            if (!open) {
                setEditingMapping(null);
                reset({ discord_role_id: '', teamspeak_sgid: '' });
            }
            setIsDialogOpen(open); 
          }}>
            <DialogTrigger asChild>
              <Button onClick={() => handleDialogOpen()}>
                <PlusCircle className="mr-2 h-4 w-4" /> Create New
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>{editingMapping ? "Edit" : "Create"} Role Mapping</DialogTitle>
                <DialogDescription>
                  {editingMapping ? "Update the TeamSpeak group for the selected Discord role." : "Map a Discord role to a TeamSpeak server group."}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
                <div>
                  <label htmlFor="discord_role_id" className="block text-sm font-medium mb-1">Discord Role</label>
                  <Controller
                    name="discord_role_id"
                    control={control}
                    render={({ field }) => (
                      <Select 
                        onValueChange={field.onChange} 
                        value={field.value}
                        disabled={!!editingMapping}
                      >
                        <SelectTrigger id="discord_role_id" className={errors.discord_role_id ? "border-destructive" : ""}>
                          <SelectValue placeholder="Select a Discord Role" />
                        </SelectTrigger>
                        <SelectContent>
                          {uniqueDiscordRoles?.map((role: DiscordRole) => (
                            <SelectItem key={role.role_id} value={role.role_id}>
                              {role.role_name} (ID: {role.role_id})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.discord_role_id && <p className="text-sm text-destructive mt-1">{errors.discord_role_id.message}</p>}
                </div>
                <div>
                  <label htmlFor="teamspeak_sgid" className="block text-sm font-medium mb-1">TeamSpeak Group</label>
                  <Controller
                    name="teamspeak_sgid"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value} >
                        <SelectTrigger id="teamspeak_sgid" className={errors.teamspeak_sgid ? "border-destructive" : ""}>
                          <SelectValue placeholder="Select a TeamSpeak Group" />
                        </SelectTrigger>
                        <SelectContent>
                          {uniqueTsGroups?.map((group: TsGroup) => (
                            <SelectItem key={group.sgid} value={String(group.sgid)}>
                              {group.name} (SGID: {group.sgid})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.teamspeak_sgid && <p className="text-sm text-destructive mt-1">{errors.teamspeak_sgid.message}</p>}
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline" onClick={() => { setEditingMapping(null); reset({ discord_role_id: '', teamspeak_sgid: '' }); }}>Cancel</Button>
                  </DialogClose>
                  <Button type="submit" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
                    {(isSubmitting || createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingMapping ? "Save Changes" : "Create Mapping"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {(roleMappings && roleMappings.length > 0) ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Discord Role</TableHead>
                  <TableHead>TeamSpeak Group</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roleMappings.map((mapping) => (
                  mapping && <TableRow key={mapping.discord_role_id}>
                    <TableCell>{discordRolesMap[mapping.discord_role_id] ?? mapping.discord_role_id}</TableCell>
                    <TableCell>{tsGroupsMap[mapping.teamspeak_sgid] ?? mapping.teamspeak_sgid}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="icon" onClick={() => handleDialogOpen(mapping)} disabled={deleteMutation.isPending || updateMutation.isPending || createMutation.isPending}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        onClick={() => deleteMutation.mutate({ discord_role_id: mapping.discord_role_id })} 
                        disabled={deleteMutation.isPending}
                      >
                        {(deleteMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No role mappings found. Create one to get started!</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 