"use client";

import React, { useState, useEffect } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Building, 
  Users, 
  Shield, 
  UserPlus, 
  Settings, 
  ArrowLeft,
  Edit,
  Trash2,
  Plus,
  Loader2
} from 'lucide-react';
import Link from "next/link";
import { toast } from "sonner";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Type definitions
type DepartmentWithRelations = RouterOutputs["dept"]["admin"]["departments"]["getById"];

interface DepartmentDetailClientProps {
  department: DepartmentWithRelations;
}

// Form schemas based on the API schemas
const createRankFormSchema = z.object({
  name: z.string().min(1, "Rank name is required").max(256),
  callsign: z.string().min(1, "Rank callsign is required").max(10),
  abbreviation: z.string().max(10).optional(),
  discordRoleId: z.string().min(1, "Discord Role ID is required").max(30),
  level: z.number().int().min(1, "Level must be at least 1"),
  salary: z.number().int().min(0).optional(),
  permissions: z.object({
    // Department-wide permissions
    manage_department: z.boolean(),
    manage_ranks: z.boolean(), 
    manage_teams: z.boolean(),
    manage_members: z.boolean(),
    view_all_members: z.boolean(),
    
    // Member management permissions
    recruit_members: z.boolean(),
    promote_members: z.boolean(),
    demote_members: z.boolean(),
    discipline_members: z.boolean(),
    remove_members: z.boolean(),
    
    // Time tracking permissions
    manage_timeclock: z.boolean(),
    view_all_timeclock: z.boolean(),
    edit_timeclock: z.boolean(),
    
    // Meeting permissions
    schedule_meetings: z.boolean(),
    manage_meetings: z.boolean(),
    take_attendance: z.boolean(),
    view_all_meetings: z.boolean(),
    
    // Team-specific permissions
    manage_team_members: z.boolean(),
    view_team_members: z.boolean()
  }).optional(),
});

const createTeamFormSchema = z.object({
  name: z.string().min(1, "Team name is required").max(256),
  description: z.string().optional(),
  callsignPrefix: z.string().max(10).optional(),
  discordRoleId: z.string().max(30).optional(),
  leaderId: z.string().optional(),
});

const createMemberFormSchema = z.object({
  discordId: z.string().min(1, "Discord ID is required"),
  roleplayName: z.string().max(100).optional(),
  rankId: z.number().int().positive().optional(),
  badgeNumber: z.string().max(20).optional(),
  primaryTeamId: z.number().int().positive().optional(),
  status: z.enum(["in_training", "pending", "active", "inactive", "leave_of_absence", "warned_1", "warned_2", "warned_3", "suspended", "blacklisted"]).optional(),
  notes: z.string().optional(),
});

const updateDepartmentFormSchema = z.object({
  name: z.string().min(1, "Department name is required").max(256),
  type: z.enum(["law_enforcement", "fire_department", "staff_team"]),
  description: z.string().optional(),
  discordGuildId: z.string().min(1, "Discord Guild ID is required").max(30),
  discordCategoryId: z.string().max(30).optional(),
  callsignPrefix: z.string().min(1, "Callsign prefix is required").max(10),
  isActive: z.boolean(),
});

type CreateRankFormData = z.infer<typeof createRankFormSchema>;
type CreateTeamFormData = z.infer<typeof createTeamFormSchema>;
type CreateMemberFormData = z.infer<typeof createMemberFormSchema>;
type UpdateDepartmentFormData = z.infer<typeof updateDepartmentFormSchema>;

const DEPARTMENT_TYPE_LABELS = {
  law_enforcement: "Law Enforcement",
  fire_department: "Fire Department", 
  staff_team: "Staff Team"
} as const;

const MEMBER_STATUS_LABELS = {
  in_training: "In Training",
  pending: "Pending",
  active: "Active",
  inactive: "Inactive",
  leave_of_absence: "Leave of Absence",
  warned_1: "Warning 1",
  warned_2: "Warning 2",
  warned_3: "Warning 3",
  suspended: "Suspended",
  blacklisted: "Blacklisted"
} as const;

// Add type definitions for sync results based on the actual return types from deptRouter.ts
type SyncResultItem = {
  success: boolean;
  updatedDepartments: Array<{ 
    departmentId: number; 
    newRankId?: number | null; 
    oldRankId?: number | null; 
    newTeamId?: number | null; 
    oldTeamId?: number | null; 
  }>;
  message: string;
};

type CreateMemberSyncResults = {
  rankSync: SyncResultItem | null;
  teamSync: SyncResultItem | null;
};

// Helper function to check if syncResults has the expected structure
const hasSyncResults = (result: unknown): result is { syncResults: CreateMemberSyncResults } => {
  return typeof result === 'object' && 
    result !== null && 
    'syncResults' in result &&
    typeof (result as Record<string, unknown>).syncResults === 'object' &&
    (result as Record<string, unknown>).syncResults !== null;
};

export default function DepartmentDetailClient({ department: initialDepartment }: DepartmentDetailClientProps) {
  const [department, setDepartment] = useState(initialDepartment);
  const [activeTab, setActiveTab] = useState("overview");
  
  // Dialog states
  const [isViewMembersDialogOpen, setIsViewMembersDialogOpen] = useState(false);
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [isAddRankDialogOpen, setIsAddRankDialogOpen] = useState(false);
  const [isAddTeamDialogOpen, setIsAddTeamDialogOpen] = useState(false);
  const [isEditDepartmentDialogOpen, setIsEditDepartmentDialogOpen] = useState(false);
  const [isEditRankDialogOpen, setIsEditRankDialogOpen] = useState(false);
  const [isEditTeamDialogOpen, setIsEditTeamDialogOpen] = useState(false);
  const [isEditMemberDialogOpen, setIsEditMemberDialogOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<{ id: number; name: string } | null>(null);
  const [selectedMemberToAdd, setSelectedMemberToAdd] = useState<string>("");
  const [selectedRank, setSelectedRank] = useState<NonNullable<DepartmentWithRelations['ranks']>[0] | null>(null);
  const [selectedTeamForEdit, setSelectedTeamForEdit] = useState<NonNullable<DepartmentWithRelations['teams']>[0] | null>(null);
  const [selectedMember, setSelectedMember] = useState<NonNullable<DepartmentWithRelations['members']>[0] | null>(null);

  // 1. Add back filter state
  const [memberStatusFilter, setMemberStatusFilter] = useState("all");
  const [memberRankFilter, setMemberRankFilter] = useState("all");
  const [memberTeamFilter, setMemberTeamFilter] = useState("all");
  const [memberSearchFilter, setMemberSearchFilter] = useState("");

  const trpcUtils = api.useUtils();

  // Use the query to get fresh data and enable refetching
  const { data: departmentData, refetch: refetchDepartment } = api.dept.admin.departments.getById.useQuery(
    { id: initialDepartment.id! },
    { 
      initialData: initialDepartment,
      refetchOnWindowFocus: false,
      enabled: !!initialDepartment.id, // Only run query if ID exists
    }
  );

  // Form instances
  const addRankForm = useForm<CreateRankFormData>({
    resolver: zodResolver(createRankFormSchema),
    defaultValues: {
      name: "",
      callsign: "",
      abbreviation: "",
      discordRoleId: "",
      level: 1,
      salary: 0,
      permissions: {
        // Department-wide permissions
        manage_department: false,
        manage_ranks: false, 
        manage_teams: false,
        manage_members: false,
        view_all_members: false,
        
        // Member management permissions
        recruit_members: false,
        promote_members: false,
        demote_members: false,
        discipline_members: false,
        remove_members: false,
        
        // Time tracking permissions
        manage_timeclock: false,
        view_all_timeclock: false,
        edit_timeclock: false,
        
        // Meeting permissions
        schedule_meetings: false,
        manage_meetings: false,
        take_attendance: false,
        view_all_meetings: false,
        
        // Team-specific permissions
        manage_team_members: false,
        view_team_members: true
      }
    }
  });

  const editRankForm = useForm<CreateRankFormData>({
    resolver: zodResolver(createRankFormSchema),
    defaultValues: {
      name: "",
      callsign: "",
      abbreviation: "",
      discordRoleId: "",
      level: 1,
      salary: 0,
      permissions: {
        manage_department: false,
        manage_ranks: false, 
        manage_teams: false,
        manage_members: false,
        view_all_members: false,
        recruit_members: false,
        promote_members: false,
        demote_members: false,
        discipline_members: false,
        remove_members: false,
        manage_timeclock: false,
        view_all_timeclock: false,
        edit_timeclock: false,
        schedule_meetings: false,
        manage_meetings: false,
        take_attendance: false,
        view_all_meetings: false,
        manage_team_members: false,
        view_team_members: true
      }
    }
  });

  const addTeamForm = useForm<CreateTeamFormData>({
    resolver: zodResolver(createTeamFormSchema),
    defaultValues: {
      name: "",
      description: "",
      callsignPrefix: "",
      discordRoleId: "",
      leaderId: "",
    }
  });

  const editTeamForm = useForm<CreateTeamFormData>({
    resolver: zodResolver(createTeamFormSchema),
    defaultValues: {
      name: "",
      description: "",
      callsignPrefix: "",
      discordRoleId: "",
      leaderId: "",
    }
  });

  const addMemberForm = useForm<CreateMemberFormData>({
    resolver: zodResolver(createMemberFormSchema),
    defaultValues: {
      discordId: "",
      badgeNumber: "",
      notes: "",
      status: "pending",
    }
  });

  const editMemberForm = useForm<CreateMemberFormData>({
    resolver: zodResolver(createMemberFormSchema),
    defaultValues: {
      discordId: "",
      badgeNumber: "",
      notes: "",
      status: "pending",
    }
  });

  const editDepartmentForm = useForm<UpdateDepartmentFormData>({
    resolver: zodResolver(updateDepartmentFormSchema),
    defaultValues: {
      name: department.name,
      type: department.type ?? "law_enforcement",
      description: department.description ?? "",
      discordGuildId: department.discordGuildId ?? "",
      discordCategoryId: department.discordCategoryId ?? "",
      callsignPrefix: department.callsignPrefix ?? "",
      isActive: department.isActive,
    }
  });

  // Sync team Discord roles mutation
  const syncTeamRolesMutation = api.dept.admin.teams.syncTeamDiscordRoles.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      if (data.errors && data.errors.length > 0) {
        toast.warning(`Some errors occurred: ${data.errors.join(', ')}`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to sync team roles: ${error.message}`);
    }
  });

  // Add member to team mutation
  const addMemberToTeamMutation = api.dept.admin.teams.addMember.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      // Comprehensive refresh for team changes
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.teams.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
      setIsAddMemberDialogOpen(false);
      setSelectedMemberToAdd("");
    },
    onError: (error) => {
      toast.error(`Failed to add member to team: ${error.message}`);
    }
  });

  // Remove member from team mutation
  const removeMemberFromTeamMutation = api.dept.admin.teams.removeMember.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      // Comprehensive refresh for team changes
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.teams.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
    },
    onError: (error) => {
      toast.error(`Failed to remove member from team: ${error.message}`);
    }
  });

  // Create rank mutation
  const createRankMutation = api.dept.admin.ranks.create.useMutation({
    onSuccess: () => {
      toast.success("Rank created successfully");
      addRankForm.reset();
      setIsAddRankDialogOpen(false);
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.ranks.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to create rank: ${error.message}`);
    }
  });

  // Update rank mutation
  const updateRankMutation = api.dept.admin.ranks.update.useMutation({
    onSuccess: () => {
      toast.success("Rank updated successfully");
      editRankForm.reset();
      setIsEditRankDialogOpen(false);
      setSelectedRank(null);
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.ranks.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to update rank: ${error.message}`);
    }
  });

  // Delete rank mutation
  const deleteRankMutation = api.dept.admin.ranks.delete.useMutation({
    onSuccess: () => {
      toast.success("Rank deleted successfully");
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.ranks.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to delete rank: ${error.message}`);
    }
  });

  // Create team mutation
  const createTeamMutation = api.dept.admin.teams.create.useMutation({
    onSuccess: () => {
      toast.success("Team created successfully");
      addTeamForm.reset();
      setIsAddTeamDialogOpen(false);
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.teams.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to create team: ${error.message}`);
    }
  });

  // Update team mutation
  const updateTeamMutation = api.dept.admin.teams.update.useMutation({
    onSuccess: () => {
      toast.success("Team updated successfully");
      editTeamForm.reset();
      setIsEditTeamDialogOpen(false);
      setSelectedTeamForEdit(null);
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.teams.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to update team: ${error.message}`);
    }
  });

  // Delete team mutation
  const deleteTeamMutation = api.dept.admin.teams.delete.useMutation({
    onSuccess: () => {
      toast.success("Team deleted successfully");
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.teams.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to delete team: ${error.message}`);
    }
  });

  // Create member mutation
  const createMemberMutation = api.dept.admin.members.create.useMutation({
    onSuccess: (result) => {
      // Show detailed success message based on what was synced
      let successMessage = "Member added successfully";
      
      // Use type-safe checking for syncResults with proper type guards
      if (hasSyncResults(result)) {
        const { rankSync, teamSync } = result.syncResults;
        
        if (rankSync && typeof rankSync === 'object' && 'success' in rankSync && 'updatedDepartments' in rankSync) {
          const typedRankSync = rankSync as SyncResultItem;
          if (typedRankSync.success && typedRankSync.updatedDepartments.length > 0) {
            successMessage += ". Rank synced from Discord roles";
          }
        }
        
        if (teamSync && typeof teamSync === 'object' && 'success' in teamSync && 'updatedDepartments' in teamSync) {
          const typedTeamSync = teamSync as SyncResultItem;
          if (typedTeamSync.success && typedTeamSync.updatedDepartments.length > 0) {
            successMessage += ". Team synced from Discord roles";
          }
        }
      }
      
      toast.success(successMessage);
      addMemberForm.reset();
      setIsAddMemberDialogOpen(false);
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to add member: ${error.message}`);
    }
  });

  // Update member mutation
  const updateMemberMutation = api.dept.admin.members.update.useMutation({
    onSuccess: () => {
      toast.success("Member updated successfully");
      editMemberForm.reset();
      setIsEditMemberDialogOpen(false);
      setSelectedMember(null);
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to update member: ${error.message}`);
    }
  });

  // Delete member mutation
  const deleteMemberMutation = api.dept.admin.members.delete.useMutation({
    onSuccess: () => {
      toast.success("Member deleted successfully");
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to delete member: ${error.message}`);
    }
  });

  // Reactivate member mutation
  const reactivateMemberMutation = api.dept.admin.members.update.useMutation({
    onSuccess: () => {
      toast.success("Member reactivated successfully");
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to reactivate member: ${error.message}`);
    }
  });

  // Hard delete member mutation (permanent removal)
  const hardDeleteMemberMutation = api.dept.admin.members.hardDelete.useMutation({
    onSuccess: () => {
      toast.success("Member permanently deleted");
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.members.listByDepartment.invalidate({ departmentId: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to permanently delete member: ${error.message}`);
    }
  });

  // Update department mutation
  const updateDepartmentMutation = api.dept.admin.departments.update.useMutation({
    onSuccess: (data) => {
      toast.success("Department updated successfully");
      setIsEditDepartmentDialogOpen(false);
      // Invalidate multiple queries to ensure full refresh
      void trpcUtils.dept.admin.departments.getById.invalidate({ id: department.id });
      void trpcUtils.dept.admin.departments.list.invalidate();
      // Update local state immediately for better UX
      setDepartment({ ...department, ...data });
      // Also trigger immediate refetch
      void refetchDepartment();
    },
    onError: (error) => {
      toast.error(`Failed to update department: ${error.message}`);
    }
  });

  // Handler functions for team actions
  const handleSyncTeamRoles = async (teamId: number, teamName: string) => {
    if (confirm(`Sync Discord roles for all members of ${teamName}? This will ensure all team members have the correct Discord role.`)) {
      await syncTeamRolesMutation.mutateAsync({ teamId });
    }
  };

  const handleViewTeamMembers = (teamId: number, teamName: string) => {
    setSelectedTeam({ id: teamId, name: teamName });
    setIsViewMembersDialogOpen(true);
  };

  const handleAddMemberToTeam = (teamId: number, teamName: string) => {
    setSelectedTeam({ id: teamId, name: teamName });
    setIsAddMemberDialogOpen(true);
  };

  const handleRemoveFromTeam = async (memberId: number, teamId: number, teamName: string) => {
    if (confirm(`Remove member from ${teamName}? This will remove them from the team but not from the department.`)) {
      await removeMemberFromTeamMutation.mutateAsync({ teamId, memberId });
    }
  };

  const handleConfirmAddMember = async () => {
    if (!selectedTeam || !selectedMemberToAdd) return;
    
    console.log("Adding member to team:", {
      teamId: selectedTeam.id,
      memberId: parseInt(selectedMemberToAdd),
      teamName: selectedTeam.name
    });
    
    try {
      const result = await addMemberToTeamMutation.mutateAsync({
        teamId: selectedTeam.id,
        memberId: parseInt(selectedMemberToAdd),
        isLeader: false
      });
      console.log("Add member result:", result);
    } catch (error) {
      console.error("Error adding member to team:", error);
    }
  };

  // Get team members for the selected team
  const getTeamMembers = () => {
    if (!selectedTeam || !department.members || !department.teamMemberships) return [];
    
    // Get member IDs that are in this team
    const teamMemberIds = department.teamMemberships
      .filter(membership => membership.teamId === selectedTeam.id)
      .map(membership => membership.memberId);
    
    // Return members that are in this team
    return department.members.filter(member => 
      teamMemberIds.includes(member.id)
    );
  };

  // Get available members to add to team (not already in the team)
  const getAvailableMembers = () => {
    if (!selectedTeam || !department.members || !department.teamMemberships) return [];
    
    // Get member IDs that are already in this team
    const teamMemberIds = department.teamMemberships
      .filter(membership => membership.teamId === selectedTeam.id)
      .map(membership => membership.memberId);
    
    // Return active members that are not already in this team
    return department.members.filter(member => 
      member.isActive && !teamMemberIds.includes(member.id)
    );
  };

  // Form submission handlers
  const handleCreateRank = async (data: CreateRankFormData) => {
    if (!department.id) {
      toast.error("Department ID is missing");
      return;
    }
    await createRankMutation.mutateAsync({
      ...data,
      departmentId: department.id,
    });
  };

  const handleUpdateRank = async (data: CreateRankFormData) => {
    if (!selectedRank?.id) {
      toast.error("Rank ID is missing");
      return;
    }
    await updateRankMutation.mutateAsync({
      id: selectedRank.id,
      ...data,
    });
  };

  const handleDeleteRank = async (rankId: number, rankName: string) => {
    if (confirm(`Are you sure you want to delete the rank "${rankName}"? This action cannot be undone.`)) {
      await deleteRankMutation.mutateAsync({ id: rankId });
    }
  };

  const handleCreateTeam = async (data: CreateTeamFormData) => {
    if (!department.id) {
      toast.error("Department ID is missing");
      return;
    }
    await createTeamMutation.mutateAsync({
      ...data,
      departmentId: department.id,
    });
  };

  const handleUpdateTeam = async (data: CreateTeamFormData) => {
    if (!selectedTeamForEdit?.id) {
      toast.error("Team ID is missing");
      return;
    }
    await updateTeamMutation.mutateAsync({
      id: selectedTeamForEdit.id,
      ...data,
    });
  };

  const handleDeleteTeam = async (teamId: number, teamName: string) => {
    if (confirm(`Are you sure you want to delete the team "${teamName}"? This action cannot be undone.`)) {
      await deleteTeamMutation.mutateAsync({ id: teamId });
    }
  };

  const handleCreateMember = async (data: CreateMemberFormData) => {
    if (!department.id) {
      toast.error("Department ID is missing");
      return;
    }

    console.log("Creating member with data:", data);

    try {
      const result = await createMemberMutation.mutateAsync({
        ...data,
        departmentId: department.id,
      });

      console.log("Member creation result:", result);

      // Additional warnings for failed syncs with proper type checking
      if (hasSyncResults(result)) {
        const syncResults = result.syncResults;
        const rankSync = syncResults?.rankSync;
        const teamSync = syncResults?.teamSync;
        
        console.log("Sync results:", { rankSync, teamSync });
        
        if (data.rankId && rankSync && typeof rankSync === 'object' && 'success' in rankSync && 'updatedDepartments' in rankSync) {
          const typedRankSync = rankSync as SyncResultItem;
          if (!typedRankSync.success || !typedRankSync.updatedDepartments?.length) {
            toast.warning("Member created but rank sync may have failed. Please verify Discord roles.");
          }
        }
        
        if (data.primaryTeamId && teamSync && typeof teamSync === 'object' && 'success' in teamSync && 'updatedDepartments' in teamSync) {
          const typedTeamSync = teamSync as SyncResultItem;
          if (!typedTeamSync.success || !typedTeamSync.updatedDepartments?.length) {
            toast.warning("Member created but team sync may have failed. Please verify Discord roles.");
          }
        }
      }
    } catch (error) {
      // Error is already handled by the mutation's onError
      console.error("Error in handleCreateMember:", error);
    }
  };

  const handleUpdateMember = async (data: CreateMemberFormData) => {
    if (!selectedMember?.id) {
      toast.error("Member ID is missing");
      return;
    }
    await updateMemberMutation.mutateAsync({
      id: selectedMember.id,
      ...data,
    });
  };

  const handleDeleteMember = async (memberId: number, memberDiscordId: string) => {
    if (confirm(`Are you sure you want to delete the member "${memberDiscordId}"? This action cannot be undone.`)) {
      await deleteMemberMutation.mutateAsync({ id: memberId });
    }
  };

  const handleReactivateMember = async (memberId: number, memberDiscordId: string) => {
    if (confirm(`Reactivate member "${memberDiscordId}"? This will restore their access to the department.`)) {
      await reactivateMemberMutation.mutateAsync({ 
        id: memberId, 
        isActive: true 
      });
    }
  };

  const handleHardDeleteMember = async (memberId: number, memberDiscordId: string) => {
    if (confirm(`⚠️ PERMANENTLY DELETE member "${memberDiscordId}"?\n\nThis action CANNOT be undone and will:\n- Remove all member data from the database\n- Free up their ID number for reuse\n- Remove them from all teams\n\nAre you absolutely sure?`)) {
      await hardDeleteMemberMutation.mutateAsync({ id: memberId });
    }
  };

  const handleUpdateDepartment = async (data: UpdateDepartmentFormData) => {
    if (!department.id) {
      toast.error("Department ID is missing");
      return;
    }
    await updateDepartmentMutation.mutateAsync({
      ...data,
      id: department.id,
    });
  };

  // Dialog open handlers
  const handleOpenAddRankDialog = () => {
    addRankForm.reset();
    setIsAddRankDialogOpen(true);
  };

  const handleOpenEditRankDialog = (rank: NonNullable<DepartmentWithRelations['ranks']>[0]) => {
    setSelectedRank(rank);
    editRankForm.reset({
      name: rank.name,
      callsign: rank.callsign,
      abbreviation: rank.abbreviation ?? "",
      discordRoleId: rank.discordRoleId,
      level: rank.level,
      salary: rank.salary ?? 0,
      permissions: rank.permissions ?? {
        manage_department: false,
        manage_ranks: false, 
        manage_teams: false,
        manage_members: false,
        view_all_members: false,
        recruit_members: false,
        promote_members: false,
        demote_members: false,
        discipline_members: false,
        remove_members: false,
        manage_timeclock: false,
        view_all_timeclock: false,
        edit_timeclock: false,
        schedule_meetings: false,
        manage_meetings: false,
        take_attendance: false,
        view_all_meetings: false,
        manage_team_members: false,
        view_team_members: true
      }
    });
    setIsEditRankDialogOpen(true);
  };

  const handleOpenAddTeamDialog = () => {
    addTeamForm.reset();
    setIsAddTeamDialogOpen(true);
  };

  const handleOpenEditTeamDialog = (team: NonNullable<DepartmentWithRelations['teams']>[0]) => {
    setSelectedTeamForEdit(team);
    editTeamForm.reset({
      name: team.name,
      description: team.description ?? "",
      callsignPrefix: team.callsignPrefix ?? "",
      discordRoleId: team.discordRoleId ?? "",
      leaderId: team.leaderId ?? "",
    });
    setIsEditTeamDialogOpen(true);
  };

  const handleOpenAddMemberDialog = () => {
    addMemberForm.reset();
    setIsAddMemberDialogOpen(true);
  };

  const handleOpenEditMemberDialog = (member: NonNullable<DepartmentWithRelations['members']>[0]) => {
    setSelectedMember(member);
    // Find the rankId from the member's rankName
    const rank = department.ranks?.find(r => r.name === member.rankName);
    editMemberForm.reset({
      discordId: member.discordId,
      roleplayName: member.roleplayName ?? "",
      rankId: rank ? rank.id : undefined,
      badgeNumber: member.badgeNumber ?? "",
      primaryTeamId: member.primaryTeamId ?? undefined,
      status: (member.status) ?? "pending",
      notes: "", // This field is not returned in the query but can be edited
    });
    setIsEditMemberDialogOpen(true);
  };
  // Edit Department Dialog
  const handleOpenEditDepartmentDialog = () => {
    editDepartmentForm.reset({
      name: department.name,
      type: department.type ?? "law_enforcement",
      description: department.description ?? "",
      discordGuildId: department.discordGuildId ?? "",
      discordCategoryId: department.discordCategoryId ?? "",
      callsignPrefix: department.callsignPrefix ?? "",
      isActive: department.isActive,
    });
    setIsEditDepartmentDialogOpen(true);
  };

  // Update department state when new data comes in
  useEffect(() => {
    if (departmentData) {
      setDepartment(departmentData);
    }
  }, [departmentData]);

  // 2. Sort and filter members
  const sortedMembers = [...(department.members ?? [])].sort((a, b) => {
    const aLevel = a.rankLevel ?? 0;
    const bLevel = b.rankLevel ?? 0;
    if (bLevel !== aLevel) return bLevel - aLevel;
    return (a.roleplayName ?? '').localeCompare(b.roleplayName ?? '');
  });
  const filteredMembers = sortedMembers.filter(member => {
    if (memberStatusFilter !== 'all' && member.status !== memberStatusFilter) return false;
    if (memberRankFilter !== 'all' && member.rankName !== department.ranks?.find(r => r.id.toString() === memberRankFilter)?.name) return false;
    if (memberTeamFilter !== 'all' && member.primaryTeamId?.toString() !== memberTeamFilter) return false;
    if (memberSearchFilter) {
      const search = memberSearchFilter.toLowerCase();
      if (!member.discordId.toLowerCase().includes(search) && !(member.roleplayName?.toLowerCase().includes(search))) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/departments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Departments
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{department.name}</h1>
            <p className="text-muted-foreground">
              {department.type && DEPARTMENT_TYPE_LABELS[department.type]} • {department.callsignPrefix}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={department.isActive ? "default" : "secondary"}>
            {department.isActive ? "Active" : "Inactive"}
          </Badge>
          <Button variant="outline" size="sm" onClick={handleOpenEditDepartmentDialog}>
            <Edit className="h-4 w-4 mr-2" />
            Edit Department
          </Button>
        </div>
      </div>

      {/* Department Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{department.members?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {department.members?.filter(m => m.isActive).length ?? 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ranks</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{department.ranks?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {department.ranks?.filter(r => r.isActive).length ?? 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Teams</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{department.teams?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {department.teams?.filter(t => t.isActive).length ?? 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Discord Guild</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-mono">{department.discordGuildId}</div>
            {department.discordCategoryId && (
              <p className="text-xs text-muted-foreground">
                Category: {department.discordCategoryId}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs for different sections */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ranks">Ranks</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Department Information</CardTitle>
              <CardDescription>Basic details about this department</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Name</label>
                  <p className="text-sm">{department.name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Type</label>
                  <p className="text-sm">{department.type && DEPARTMENT_TYPE_LABELS[department.type]}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Callsign Prefix</label>
                  <p className="text-sm font-mono">{department.callsignPrefix}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <Badge variant={department.isActive ? "default" : "secondary"}>
                    {department.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>
              {department.description && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Description</label>
                  <p className="text-sm">{department.description}</p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Created</label>
                  <p className="text-sm">{department.createdAt ? new Date(department.createdAt).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Discord Role Management Section */}
          <Card>
            <CardHeader>
              <CardTitle>Discord Role Management</CardTitle>
              <CardDescription>Team Discord role synchronization and management</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Discord roles are automatically managed when team members are added or removed. 
                    You can also manually sync roles for all teams.
                  </p>
                </div>
                
                {department.teams && department.teams.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Teams with Discord Roles:</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {department.teams
                        .filter(team => team.discordRoleId && team.isActive)
                        .map(team => (
                          <div key={team.id} className="flex items-center justify-between p-2 border rounded">
                            <div>
                              <p className="text-sm font-medium">{team.name}</p>
                              <code className="text-xs text-muted-foreground">{team.discordRoleId}</code>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSyncTeamRoles(team.id, team.name)}
                              disabled={syncTeamRolesMutation.isPending}
                            >
                              {syncTeamRolesMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Settings className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {(!department.teams || department.teams.filter(team => team.discordRoleId && team.isActive).length === 0) && (
                  <div className="text-center py-4 text-muted-foreground">
                    <p>No teams have Discord roles configured</p>
                    <p className="text-xs">Add Discord role IDs to teams to enable automatic role management</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ranks" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Department Ranks</CardTitle>
                  <CardDescription>Manage ranks and hierarchy within this department</CardDescription>
                </div>
                <Button onClick={handleOpenAddRankDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Rank
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Callsign</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Discord Role</TableHead>
                      <TableHead>Max Members</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!department.ranks || department.ranks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <p className="text-muted-foreground">No ranks found</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      department.ranks.map((rank) => (
                        <TableRow key={rank.id}>
                          <TableCell className="font-medium">{rank.name}</TableCell>
                          <TableCell>
                            <code className="px-2 py-1 bg-muted rounded text-sm">
                              {rank.callsign}
                            </code>
                          </TableCell>
                          <TableCell>{rank.level}</TableCell>
                          <TableCell>
                            <code className="text-sm">{rank.discordRoleId}</code>
                          </TableCell>
                          <TableCell>
                            {rank.maxMembers ?? "Unlimited"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={rank.isActive ? "default" : "secondary"}>
                              {rank.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleOpenEditRankDialog(rank)}>
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => handleDeleteRank(rank.id, rank.name)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Department Teams</CardTitle>
                  <CardDescription>Manage specialized teams within this department</CardDescription>
                </div>
                <Button onClick={handleOpenAddTeamDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Team
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Callsign Prefix</TableHead>
                      <TableHead>Leader</TableHead>
                      <TableHead>Discord Role</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!department.teams || department.teams.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <p className="text-muted-foreground">No teams found</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      department.teams.map((team) => {
                        // Count team members using team memberships data
                        const teamMemberCount = department.teamMemberships?.filter(
                          membership => membership.teamId === team.id
                        ).length ?? 0;

                        return (
                          <TableRow key={team.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{team.name}</p>
                                {team.description && (
                                  <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                                    {team.description}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {team.callsignPrefix ? (
                                <code className="px-2 py-1 bg-muted rounded text-sm">
                                  {team.callsignPrefix}
                                </code>
                              ) : (
                                <span className="text-muted-foreground">None</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {team.leaderId ? (
                                <code className="text-sm">{team.leaderId}</code>
                              ) : (
                                <span className="text-muted-foreground">No leader</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {team.discordRoleId ? (
                                  <>
                                    <code className="text-sm">{team.discordRoleId}</code>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleSyncTeamRoles(team.id, team.name)}
                                      title="Sync Discord roles for all team members"
                                    >
                                      <Settings className="h-3 w-3" />
                                    </Button>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">None</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{teamMemberCount}</Badge>
                                {teamMemberCount > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleViewTeamMembers(team.id, team.name)}
                                    title="View team members"
                                  >
                                    <Users className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={team.isActive ? "default" : "secondary"}>
                                {team.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAddMemberToTeam(team.id, team.name)}
                                  title="Add member to team"
                                >
                                  <UserPlus className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleOpenEditTeamDialog(team)}
                                  title="Edit team"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDeleteTeam(team.id, team.name)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Department Members</CardTitle>
                  <CardDescription>Manage members of this department</CardDescription>
                </div>
                <Button onClick={handleOpenAddMemberDialog}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Member
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                <Select value={memberStatusFilter} onValueChange={setMemberStatusFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={memberRankFilter} onValueChange={setMemberRankFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Rank" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Ranks</SelectItem>
                    {department.ranks?.map(rank => (
                      <SelectItem key={rank.id} value={rank.id.toString()}>{rank.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={memberTeamFilter} onValueChange={setMemberTeamFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Team" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {department.teams?.map(team => (
                      <SelectItem key={team.id} value={team.id.toString()}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input className="w-[180px]" placeholder="Search..." value={memberSearchFilter} onChange={e => setMemberSearchFilter(e.target.value)} />
              </div>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Discord ID</TableHead>
                      <TableHead>Roleplay Name</TableHead>
                      <TableHead>Callsign</TableHead>
                      <TableHead>Badge Number</TableHead>
                      <TableHead>Primary Team</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Hire Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!department.members || department.members.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <p className="text-muted-foreground">No members found</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMembers.map((member) => {
                        // Find the member's primary team
                        const primaryTeam = member.primaryTeamId 
                          ? department.teams?.find(team => team.id === member.primaryTeamId)
                          : null;

                        return (
                          <TableRow key={member.id} className={!member.isActive ? "opacity-60 bg-muted/20" : ""}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <code className="text-sm">{member.discordId}</code>
                                {!member.isActive && (
                                  <Badge variant="secondary" className="text-xs">Inactive</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {member.roleplayName ?? <span className="text-muted-foreground">No name</span>}
                            </TableCell>
                            <TableCell>
                              {member.callsign ? (
                                <code className="px-2 py-1 bg-muted rounded text-sm">
                                  {member.callsign}
                                </code>
                              ) : (
                                <span className="text-muted-foreground">Not assigned</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {member.badgeNumber ?? <span className="text-muted-foreground">None</span>}
                            </TableCell>
                            <TableCell>
                              {primaryTeam ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">{primaryTeam.name}</Badge>
                                  {member.isActive && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleRemoveFromTeam(member.id, primaryTeam.id, primaryTeam.name)}
                                      title="Remove from primary team"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">No team</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {member.status && MEMBER_STATUS_LABELS[member.status]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {new Date(member.hireDate).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {member.isActive ? (
                                  <>
                                    <Button variant="outline" size="sm" onClick={() => handleOpenEditMemberDialog(member)}>
                                      <Edit className="h-3 w-3" />
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => handleDeleteMember(member.id, member.discordId)}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button variant="outline" size="sm" onClick={() => handleReactivateMember(member.id, member.discordId)} title="Reactivate member">
                                      <UserPlus className="h-3 w-3" />
                                    </Button>
                                    <Button 
                                      variant="destructive" 
                                      size="sm" 
                                      onClick={() => handleHardDeleteMember(member.id, member.discordId)}
                                      title="Permanently delete member"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* View Team Members Dialog */}
      <Dialog open={isViewMembersDialogOpen} onOpenChange={setIsViewMembersDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Team Members</DialogTitle>
            <DialogDescription>
              {selectedTeam ? `Members of ${selectedTeam.name}` : 'Select a team to view members'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedTeam && (
            <div className="space-y-4">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Discord ID</TableHead>
                      <TableHead>Callsign</TableHead>
                      <TableHead>Badge Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {getTeamMembers().length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-4">
                          <p className="text-muted-foreground">No members in this team</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      getTeamMembers().map((member) => (
                        <TableRow key={member.id}>
                          <TableCell>
                            <code className="text-sm">{member.discordId}</code>
                          </TableCell>
                          <TableCell>
                            {member.callsign ? (
                              <code className="px-2 py-1 bg-muted rounded text-sm">
                                {member.callsign}
                              </code>
                            ) : (
                              <span className="text-muted-foreground">Not assigned</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {member.badgeNumber ?? <span className="text-muted-foreground">None</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {member.status && MEMBER_STATUS_LABELS[member.status]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRemoveFromTeam(member.id, selectedTeam.id, selectedTeam.name)}
                              disabled={removeMemberFromTeamMutation.isPending}
                            >
                              {removeMemberFromTeamMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewMembersDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Member to Team Dialog */}
      <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Member to Team</DialogTitle>
            <DialogDescription>
              {selectedTeam ? `Add a member to ${selectedTeam.name}` : 'Select member to add to team'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="member-select">Select Member</Label>
              <Select value={selectedMemberToAdd} onValueChange={setSelectedMemberToAdd}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a member to add" />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableMembers().length === 0 ? (
                    <SelectItem value="no-members" disabled>
                      No available members
                    </SelectItem>
                  ) : (
                    getAvailableMembers().map((member) => (
                      <SelectItem key={member.id} value={member.id.toString()}>
                        <div className="flex items-center gap-2">
                          <code className="text-xs">{member.discordId}</code>
                          {member.callsign && (
                            <span className="text-sm">({member.callsign})</span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setIsAddMemberDialogOpen(false);
                setSelectedMemberToAdd("");
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmAddMember}
              disabled={!selectedMemberToAdd || addMemberToTeamMutation.isPending || getAvailableMembers().length === 0}
            >
              {addMemberToTeamMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Member'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Department Dialog */}
      <Dialog open={isEditDepartmentDialogOpen} onOpenChange={setIsEditDepartmentDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
            <DialogDescription>Update department details and settings</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={editDepartmentForm.handleSubmit(handleUpdateDepartment)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dept-name">Department Name</Label>
                <Input
                  id="dept-name"
                  {...editDepartmentForm.register("name")}
                  placeholder="Enter department name"
                />
                {editDepartmentForm.formState.errors.name && (
                  <p className="text-sm text-red-500">{editDepartmentForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dept-type">Department Type</Label>
                <Select
                  value={editDepartmentForm.watch("type")}
                  onValueChange={(value) => editDepartmentForm.setValue("type", value as "law_enforcement" | "fire_department" | "staff_team")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="law_enforcement">Law Enforcement</SelectItem>
                    <SelectItem value="fire_department">Fire Department</SelectItem>
                    <SelectItem value="staff_team">Staff Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dept-description">Description</Label>
              <Textarea
                id="dept-description"
                {...editDepartmentForm.register("description")}
                placeholder="Enter department description (optional)"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dept-discord-guild">Discord Guild ID</Label>
                <Input
                  id="dept-discord-guild"
                  {...editDepartmentForm.register("discordGuildId")}
                  placeholder="Enter Discord Guild ID"
                />
                {editDepartmentForm.formState.errors.discordGuildId && (
                  <p className="text-sm text-red-500">{editDepartmentForm.formState.errors.discordGuildId.message}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="dept-discord-category">Discord Category ID</Label>
                <Input
                  id="dept-discord-category"
                  {...editDepartmentForm.register("discordCategoryId")}
                  placeholder="Enter Discord Category ID (optional)"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dept-callsign-prefix">Callsign Prefix</Label>
                <Input
                  id="dept-callsign-prefix"
                  {...editDepartmentForm.register("callsignPrefix")}
                  placeholder="Enter callsign prefix"
                  style={{ textTransform: 'uppercase' }}
                  onChange={(e) => {
                    e.target.value = e.target.value.toUpperCase();
                    editDepartmentForm.setValue("callsignPrefix", e.target.value);
                  }}
                />
                {editDepartmentForm.formState.errors.callsignPrefix && (
                  <p className="text-sm text-red-500">{editDepartmentForm.formState.errors.callsignPrefix.message}</p>
                )}
              </div>
              
              <div className="space-y-2 flex items-center">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="dept-active"
                    checked={editDepartmentForm.watch("isActive")}
                    onCheckedChange={(checked) => editDepartmentForm.setValue("isActive", !!checked)}
                  />
                  <Label htmlFor="dept-active">Active Department</Label>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button 
                type="button"
                variant="outline" 
                onClick={() => setIsEditDepartmentDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={updateDepartmentMutation.isPending}
              >
                {updateDepartmentMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Department'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Rank Dialog */}
      <Dialog open={isAddRankDialogOpen} onOpenChange={setIsAddRankDialogOpen}>
        <DialogContent className="sm:max-w-[700px] h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Add New Rank</DialogTitle>
            <DialogDescription>Create a new rank for this department</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={addRankForm.handleSubmit((data: CreateRankFormData) => handleCreateRank(data))} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto pr-2 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rank-name">Rank Name</Label>
                  <Input
                    id="rank-name"
                    {...addRankForm.register("name")}
                    placeholder="Enter rank name"
                  />
                  {addRankForm.formState.errors.name && (
                    <p className="text-sm text-red-500">{addRankForm.formState.errors.name.message}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="rank-callsign">Rank Callsign</Label>
                  <Input
                    id="rank-callsign"
                    {...addRankForm.register("callsign")}
                    placeholder="Enter rank callsign"
                    style={{ textTransform: 'uppercase' }}
                    onChange={(e) => {
                      e.target.value = e.target.value.toUpperCase();
                      addRankForm.setValue("callsign", e.target.value);
                    }}
                  />
                  {addRankForm.formState.errors.callsign && (
                    <p className="text-sm text-red-500">{addRankForm.formState.errors.callsign.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rank-abbreviation">Abbreviation</Label>
                  <Input
                    id="rank-abbreviation"
                    {...addRankForm.register("abbreviation")}
                    placeholder="Enter abbreviation (optional)"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="rank-discord-role">Discord Role ID</Label>
                  <Input
                    id="rank-discord-role"
                    {...addRankForm.register("discordRoleId")}
                    placeholder="Enter Discord Role ID"
                  />
                  {addRankForm.formState.errors.discordRoleId && (
                    <p className="text-sm text-red-500">{addRankForm.formState.errors.discordRoleId.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rank-level">Level</Label>
                  <Input
                    id="rank-level"
                    type="number"
                    min="1"
                    {...addRankForm.register("level", { valueAsNumber: true })}
                    placeholder="Enter rank level"
                  />
                  {addRankForm.formState.errors.level && (
                    <p className="text-sm text-red-500">{addRankForm.formState.errors.level.message}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="rank-salary">Salary</Label>
                  <Input
                    id="rank-salary"
                    type="number"
                    min="0"
                    {...addRankForm.register("salary", { valueAsNumber: true })}
                    placeholder="Enter salary (optional)"
                  />
                </div>
              </div>

              {/* Permissions Section */}
              <div className="space-y-4">
                <div className="border-t pt-4">
                  <Label className="text-base font-medium">Rank Permissions</Label>
                  <p className="text-sm text-muted-foreground mb-4">
                    Configure what actions members with this rank can perform
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Department-wide permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Department Management</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_department"
                            checked={addRankForm.watch("permissions.manage_department") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.manage_department", !!checked)}
                          />
                          <Label htmlFor="manage_department" className="text-sm">Manage Department</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_ranks"
                            checked={addRankForm.watch("permissions.manage_ranks") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.manage_ranks", !!checked)}
                          />
                          <Label htmlFor="manage_ranks" className="text-sm">Manage Ranks</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_teams"
                            checked={addRankForm.watch("permissions.manage_teams") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.manage_teams", !!checked)}
                          />
                          <Label htmlFor="manage_teams" className="text-sm">Manage Teams</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_members"
                            checked={addRankForm.watch("permissions.manage_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.manage_members", !!checked)}
                          />
                          <Label htmlFor="manage_members" className="text-sm">Manage Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_all_members"
                            checked={addRankForm.watch("permissions.view_all_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.view_all_members", !!checked)}
                          />
                          <Label htmlFor="view_all_members" className="text-sm">View All Members</Label>
                        </div>
                      </div>
                    </div>

                    {/* Member management permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Member Management</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="recruit_members"
                            checked={addRankForm.watch("permissions.recruit_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.recruit_members", !!checked)}
                          />
                          <Label htmlFor="recruit_members" className="text-sm">Recruit Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="promote_members"
                            checked={addRankForm.watch("permissions.promote_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.promote_members", !!checked)}
                          />
                          <Label htmlFor="promote_members" className="text-sm">Promote Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="demote_members"
                            checked={addRankForm.watch("permissions.demote_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.demote_members", !!checked)}
                          />
                          <Label htmlFor="demote_members" className="text-sm">Demote Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="discipline_members"
                            checked={addRankForm.watch("permissions.discipline_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.discipline_members", !!checked)}
                          />
                          <Label htmlFor="discipline_members" className="text-sm">Discipline Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="remove_members"
                            checked={addRankForm.watch("permissions.remove_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.remove_members", !!checked)}
                          />
                          <Label htmlFor="remove_members" className="text-sm">Remove Members</Label>
                        </div>
                      </div>
                    </div>

                    {/* Time tracking permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Time Tracking</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_timeclock"
                            checked={addRankForm.watch("permissions.manage_timeclock") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.manage_timeclock", !!checked)}
                          />
                          <Label htmlFor="manage_timeclock" className="text-sm">Manage Timeclock</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_all_timeclock"
                            checked={addRankForm.watch("permissions.view_all_timeclock") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.view_all_timeclock", !!checked)}
                          />
                          <Label htmlFor="view_all_timeclock" className="text-sm">View All Timeclock</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="edit_timeclock"
                            checked={addRankForm.watch("permissions.edit_timeclock") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.edit_timeclock", !!checked)}
                          />
                          <Label htmlFor="edit_timeclock" className="text-sm">Edit Timeclock</Label>
                        </div>
                      </div>
                    </div>

                    {/* Meeting permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Meetings & Teams</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="schedule_meetings"
                            checked={addRankForm.watch("permissions.schedule_meetings") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.schedule_meetings", !!checked)}
                          />
                          <Label htmlFor="schedule_meetings" className="text-sm">Schedule Meetings</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_meetings"
                            checked={addRankForm.watch("permissions.manage_meetings") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.manage_meetings", !!checked)}
                          />
                          <Label htmlFor="manage_meetings" className="text-sm">Manage Meetings</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="take_attendance"
                            checked={addRankForm.watch("permissions.take_attendance") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.take_attendance", !!checked)}
                          />
                          <Label htmlFor="take_attendance" className="text-sm">Take Attendance</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_all_meetings"
                            checked={addRankForm.watch("permissions.view_all_meetings") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.view_all_meetings", !!checked)}
                          />
                          <Label htmlFor="view_all_meetings" className="text-sm">View All Meetings</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_team_members"
                            checked={addRankForm.watch("permissions.manage_team_members") ?? false}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.manage_team_members", !!checked)}
                          />
                          <Label htmlFor="manage_team_members" className="text-sm">Manage Team Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_team_members"
                            checked={addRankForm.watch("permissions.view_team_members") ?? true}
                            onCheckedChange={(checked) => addRankForm.setValue("permissions.view_team_members", !!checked)}
                          />
                          <Label htmlFor="view_team_members" className="text-sm">View Team Members</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="flex-shrink-0 border-t pt-4 mt-4">
              <Button 
                type="button"
                variant="outline" 
                onClick={() => setIsAddRankDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={createRankMutation.isPending}
              >
                {createRankMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Rank'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Rank Dialog */}
      <Dialog open={isEditRankDialogOpen} onOpenChange={setIsEditRankDialogOpen}>
        <DialogContent className="sm:max-w-[700px] h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Edit Rank</DialogTitle>
            <DialogDescription>Update rank details and permissions</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={editRankForm.handleSubmit(handleUpdateRank)} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto pr-2 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rank-name">Rank Name</Label>
                  <Input
                    id="rank-name"
                    {...editRankForm.register("name")}
                    placeholder="Enter rank name"
                  />
                  {editRankForm.formState.errors.name && (
                    <p className="text-sm text-red-500">{editRankForm.formState.errors.name.message}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="rank-callsign">Rank Callsign</Label>
                  <Input
                    id="rank-callsign"
                    {...editRankForm.register("callsign")}
                    placeholder="Enter rank callsign"
                    style={{ textTransform: 'uppercase' }}
                    onChange={(e) => {
                      e.target.value = e.target.value.toUpperCase();
                      editRankForm.setValue("callsign", e.target.value);
                    }}
                  />
                  {editRankForm.formState.errors.callsign && (
                    <p className="text-sm text-red-500">{editRankForm.formState.errors.callsign.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rank-abbreviation">Abbreviation</Label>
                  <Input
                    id="rank-abbreviation"
                    {...editRankForm.register("abbreviation")}
                    placeholder="Enter abbreviation (optional)"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="rank-discord-role">Discord Role ID</Label>
                  <Input
                    id="rank-discord-role"
                    {...editRankForm.register("discordRoleId")}
                    placeholder="Enter Discord Role ID"
                  />
                  {editRankForm.formState.errors.discordRoleId && (
                    <p className="text-sm text-red-500">{editRankForm.formState.errors.discordRoleId.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rank-level">Level</Label>
                  <Input
                    id="rank-level"
                    type="number"
                    min="1"
                    {...editRankForm.register("level", { valueAsNumber: true })}
                    placeholder="Enter rank level"
                  />
                  {editRankForm.formState.errors.level && (
                    <p className="text-sm text-red-500">{editRankForm.formState.errors.level.message}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="rank-salary">Salary</Label>
                  <Input
                    id="rank-salary"
                    type="number"
                    min="0"
                    {...editRankForm.register("salary", { valueAsNumber: true })}
                    placeholder="Enter salary (optional)"
                  />
                </div>
              </div>

              {/* Permissions Section */}
              <div className="space-y-4">
                <div className="border-t pt-4">
                  <Label className="text-base font-medium">Rank Permissions</Label>
                  <p className="text-sm text-muted-foreground mb-4">
                    Configure what actions members with this rank can perform
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Department-wide permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Department Management</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_department"
                            checked={editRankForm.watch("permissions.manage_department") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.manage_department", !!checked)}
                          />
                          <Label htmlFor="manage_department" className="text-sm">Manage Department</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_ranks"
                            checked={editRankForm.watch("permissions.manage_ranks") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.manage_ranks", !!checked)}
                          />
                          <Label htmlFor="manage_ranks" className="text-sm">Manage Ranks</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_teams"
                            checked={editRankForm.watch("permissions.manage_teams") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.manage_teams", !!checked)}
                          />
                          <Label htmlFor="manage_teams" className="text-sm">Manage Teams</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_members"
                            checked={editRankForm.watch("permissions.manage_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.manage_members", !!checked)}
                          />
                          <Label htmlFor="manage_members" className="text-sm">Manage Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_all_members"
                            checked={editRankForm.watch("permissions.view_all_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.view_all_members", !!checked)}
                          />
                          <Label htmlFor="view_all_members" className="text-sm">View All Members</Label>
                        </div>
                      </div>
                    </div>

                    {/* Member management permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Member Management</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="recruit_members"
                            checked={editRankForm.watch("permissions.recruit_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.recruit_members", !!checked)}
                          />
                          <Label htmlFor="recruit_members" className="text-sm">Recruit Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="promote_members"
                            checked={editRankForm.watch("permissions.promote_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.promote_members", !!checked)}
                          />
                          <Label htmlFor="promote_members" className="text-sm">Promote Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="demote_members"
                            checked={editRankForm.watch("permissions.demote_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.demote_members", !!checked)}
                          />
                          <Label htmlFor="demote_members" className="text-sm">Demote Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="discipline_members"
                            checked={editRankForm.watch("permissions.discipline_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.discipline_members", !!checked)}
                          />
                          <Label htmlFor="discipline_members" className="text-sm">Discipline Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="remove_members"
                            checked={editRankForm.watch("permissions.remove_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.remove_members", !!checked)}
                          />
                          <Label htmlFor="remove_members" className="text-sm">Remove Members</Label>
                        </div>
                      </div>
                    </div>

                    {/* Time tracking permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Time Tracking</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_timeclock"
                            checked={editRankForm.watch("permissions.manage_timeclock") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.manage_timeclock", !!checked)}
                          />
                          <Label htmlFor="manage_timeclock" className="text-sm">Manage Timeclock</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_all_timeclock"
                            checked={editRankForm.watch("permissions.view_all_timeclock") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.view_all_timeclock", !!checked)}
                          />
                          <Label htmlFor="view_all_timeclock" className="text-sm">View All Timeclock</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="edit_timeclock"
                            checked={editRankForm.watch("permissions.edit_timeclock") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.edit_timeclock", !!checked)}
                          />
                          <Label htmlFor="edit_timeclock" className="text-sm">Edit Timeclock</Label>
                        </div>
                      </div>
                    </div>

                    {/* Meeting permissions */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Meetings & Teams</h4>
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="schedule_meetings"
                            checked={editRankForm.watch("permissions.schedule_meetings") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.schedule_meetings", !!checked)}
                          />
                          <Label htmlFor="schedule_meetings" className="text-sm">Schedule Meetings</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_meetings"
                            checked={editRankForm.watch("permissions.manage_meetings") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.manage_meetings", !!checked)}
                          />
                          <Label htmlFor="manage_meetings" className="text-sm">Manage Meetings</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="take_attendance"
                            checked={editRankForm.watch("permissions.take_attendance") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.take_attendance", !!checked)}
                          />
                          <Label htmlFor="take_attendance" className="text-sm">Take Attendance</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_all_meetings"
                            checked={editRankForm.watch("permissions.view_all_meetings") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.view_all_meetings", !!checked)}
                          />
                          <Label htmlFor="view_all_meetings" className="text-sm">View All Meetings</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="manage_team_members"
                            checked={editRankForm.watch("permissions.manage_team_members") ?? false}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.manage_team_members", !!checked)}
                          />
                          <Label htmlFor="manage_team_members" className="text-sm">Manage Team Members</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="view_team_members"
                            checked={editRankForm.watch("permissions.view_team_members") ?? true}
                            onCheckedChange={(checked) => editRankForm.setValue("permissions.view_team_members", !!checked)}
                          />
                          <Label htmlFor="view_team_members" className="text-sm">View Team Members</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="flex-shrink-0 border-t pt-4 mt-4">
              <Button 
                type="button"
                variant="outline" 
                onClick={() => setIsEditRankDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={updateRankMutation.isPending}
              >
                {updateRankMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Rank'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Team Dialog */}
      <Dialog open={isAddTeamDialogOpen} onOpenChange={setIsAddTeamDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add New Team</DialogTitle>
            <DialogDescription>Create a new specialized team for this department</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={addTeamForm.handleSubmit(handleCreateTeam)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                {...addTeamForm.register("name")}
                placeholder="Enter team name"
              />
              {addTeamForm.formState.errors.name && (
                <p className="text-sm text-red-500">{addTeamForm.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                {...addTeamForm.register("description")}
                placeholder="Enter team description (optional)"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="team-callsign-prefix">Callsign Prefix</Label>
                <Input
                  id="team-callsign-prefix"
                  {...addTeamForm.register("callsignPrefix")}
                  placeholder="Enter callsign prefix (optional)"
                  style={{ textTransform: 'uppercase' }}
                  onChange={(e) => {
                    e.target.value = e.target.value.toUpperCase();
                    addTeamForm.setValue("callsignPrefix", e.target.value);
                  }}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="team-discord-role">Discord Role ID</Label>
                <Input
                  id="team-discord-role"
                  {...addTeamForm.register("discordRoleId")}
                  placeholder="Enter Discord Role ID (optional)"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-leader">Team Leader ID</Label>
              <Input
                id="team-leader"
                {...addTeamForm.register("leaderId")}
                placeholder="Enter team leader Discord ID (optional)"
              />
            </div>

            <DialogFooter>
              <Button 
                type="button"
                variant="outline" 
                onClick={() => setIsAddTeamDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={createTeamMutation.isPending}
              >
                {createTeamMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Team'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Team Dialog */}
      <Dialog open={isEditTeamDialogOpen} onOpenChange={setIsEditTeamDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Team</DialogTitle>
            <DialogDescription>Update team details and members</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={editTeamForm.handleSubmit(handleUpdateTeam)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                {...editTeamForm.register("name")}
                placeholder="Enter team name"
              />
              {editTeamForm.formState.errors.name && (
                <p className="text-sm text-red-500">{editTeamForm.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                {...editTeamForm.register("description")}
                placeholder="Enter team description (optional)"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="team-callsign-prefix">Callsign Prefix</Label>
                <Input
                  id="team-callsign-prefix"
                  {...editTeamForm.register("callsignPrefix")}
                  placeholder="Enter callsign prefix (optional)"
                  style={{ textTransform: 'uppercase' }}
                  onChange={(e) => {
                    e.target.value = e.target.value.toUpperCase();
                    editTeamForm.setValue("callsignPrefix", e.target.value);
                  }}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="team-discord-role">Discord Role ID</Label>
                <Input
                  id="team-discord-role"
                  {...editTeamForm.register("discordRoleId")}
                  placeholder="Enter Discord Role ID (optional)"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-leader">Team Leader ID</Label>
              <Input
                id="team-leader"
                {...editTeamForm.register("leaderId")}
                placeholder="Enter team leader Discord ID (optional)"
              />
            </div>

            <DialogFooter>
              <Button 
                type="button"
                variant="outline" 
                onClick={() => setIsEditTeamDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={updateTeamMutation.isPending}
              >
                {updateTeamMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Team'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={isAddMemberDialogOpen} onOpenChange={() => {
        setIsAddMemberDialogOpen(false);
        addMemberForm.reset();
      }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add New Member</DialogTitle>
            <DialogDescription>Add a new member to this department</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={addMemberForm.handleSubmit(handleCreateMember)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="member-discord-id">Discord ID</Label>
              <Input
                id="member-discord-id"
                {...addMemberForm.register("discordId")}
                placeholder="Enter member's Discord ID"
              />
              {addMemberForm.formState.errors.discordId && (
                <p className="text-sm text-red-500">{addMemberForm.formState.errors.discordId.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="member-roleplay-name">Roleplay Name</Label>
                <Input
                  id="member-roleplay-name"
                  {...addMemberForm.register("roleplayName")}
                  placeholder="Enter member's roleplay name (optional)"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="member-rank">Rank</Label>
                <Select
                  value={addMemberForm.watch("rankId")?.toString() ?? "none"}
                  onValueChange={(value) => addMemberForm.setValue("rankId", value === "none" ? undefined : parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select rank (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No rank</SelectItem>
                    {department.ranks?.filter(r => r.isActive).map((rank) => (
                      <SelectItem key={rank.id} value={rank.id.toString()}>
                        {rank.name} ({rank.callsign})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="member-badge">Badge Number</Label>
                <Input
                  id="member-badge"
                  {...addMemberForm.register("badgeNumber")}
                  placeholder="Enter badge number (optional)"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="member-team">Primary Team</Label>
                <Select
                  value={addMemberForm.watch("primaryTeamId")?.toString() ?? "none"}
                  onValueChange={(value) => addMemberForm.setValue("primaryTeamId", value === "none" ? undefined : parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {department.teams?.filter(t => t.isActive).map((team) => (
                      <SelectItem key={team.id} value={team.id.toString()}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="member-status">Status</Label>
                <Select
                  value={addMemberForm.watch("status") ?? "pending"}
                  onValueChange={(value) => addMemberForm.setValue("status", value as "in_training" | "pending" | "active" | "inactive" | "leave_of_absence" | "warned_1" | "warned_2" | "warned_3" | "suspended" | "blacklisted")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-notes">Notes</Label>
              <Textarea
                id="member-notes"
                {...addMemberForm.register("notes")}
                placeholder="Enter any notes about this member (optional)"
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button 
                type="button"
                variant="outline" 
                onClick={() => {
                  setIsAddMemberDialogOpen(false);
                  addMemberForm.reset();
                }}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={createMemberMutation.isPending}
              >
                {createMemberMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Member'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Member Dialog */}
      <Dialog open={isEditMemberDialogOpen} onOpenChange={() => {
        setIsEditMemberDialogOpen(false);
        setSelectedMember(null);
        editMemberForm.reset();
      }}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Member Details</DialogTitle>
            <DialogDescription>View and manage member information</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="edit">Edit Details</TabsTrigger>
              <TabsTrigger value="other">Other Features</TabsTrigger>
            </TabsList>
            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4">
              {selectedMember && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Roleplay Name</label>
                      <p className="text-sm text-muted-foreground">{selectedMember.roleplayName ?? 'Not set'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Discord ID</label>
                      <p className="text-sm font-mono">{selectedMember.discordId}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Badge Number</label>
                      <p className="text-sm text-muted-foreground">{selectedMember.badgeNumber ?? 'Not assigned'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Status</label>
                      <Badge variant="outline">{selectedMember.status}</Badge>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Rank</label>
                      <p className="text-sm text-muted-foreground">{selectedMember.rankName ?? 'No rank'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Primary Team</label>
                      <p className="text-sm text-muted-foreground">{selectedMember.primaryTeamId ? (department.teams?.find(t => t.id === selectedMember.primaryTeamId)?.name ?? 'Unknown') : 'No team'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Hire Date</label>
                      <p className="text-sm text-muted-foreground">{selectedMember.hireDate ? new Date(selectedMember.hireDate).toLocaleDateString() : 'Not set'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    {selectedMember.isActive ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleDeleteMember(selectedMember.id, selectedMember.discordId)}>
                          Remove Member
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleReactivateMember(selectedMember.id, selectedMember.discordId)}>
                          Reactivate Member
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleHardDeleteMember(selectedMember.id, selectedMember.discordId)}>
                          Hard Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
            {/* Edit Details Tab */}
            <TabsContent value="edit" className="space-y-4">
              {selectedMember && (
                <form onSubmit={editMemberForm.handleSubmit(handleUpdateMember)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-member-roleplay-name">Roleplay Name</Label>
                      <Input id="edit-member-roleplay-name" {...editMemberForm.register("roleplayName")} placeholder="Enter member's roleplay name (optional)" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-member-badge">Badge Number</Label>
                      <Input id="edit-member-badge" {...editMemberForm.register("badgeNumber")} placeholder="Enter badge number (optional)" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-member-rank">Rank</Label>
                      <Select value={editMemberForm.watch("rankId")?.toString() ?? "none"} onValueChange={(value) => editMemberForm.setValue("rankId", value === "none" ? undefined : parseInt(value))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select rank (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No rank</SelectItem>
                          {department.ranks?.filter(r => r.isActive).map((rank) => (
                            <SelectItem key={rank.id} value={rank.id.toString()}>{rank.name} ({rank.callsign})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-member-team">Primary Team</Label>
                      <Select value={editMemberForm.watch("primaryTeamId")?.toString() ?? "none"} onValueChange={(value) => editMemberForm.setValue("primaryTeamId", value === "none" ? undefined : parseInt(value))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select team (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No team</SelectItem>
                          {department.teams?.filter(t => t.isActive).map((team) => (
                            <SelectItem key={team.id} value={team.id.toString()}>{team.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-member-status">Status</Label>
                      <Select value={editMemberForm.watch("status") ?? "pending"} onValueChange={(value) => editMemberForm.setValue("status", value as "in_training" | "pending" | "active" | "inactive" | "leave_of_absence" | "warned_1" | "warned_2" | "warned_3" | "suspended" | "blacklisted")}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-member-notes">Notes</Label>
                    <Textarea id="edit-member-notes" {...editMemberForm.register("notes")} placeholder="Enter any notes about this member (optional)" rows={3} />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => {
                      setIsEditMemberDialogOpen(false);
                      setSelectedMember(null);
                      editMemberForm.reset();
                    }}>Cancel</Button>
                    <Button type="submit" disabled={updateMemberMutation.isPending}>{updateMemberMutation.isPending ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</>) : ('Update Member')}</Button>
                  </DialogFooter>
                </form>
              )}
            </TabsContent>
            {/* Placeholder for future features */}
            <TabsContent value="other" className="space-y-4 text-center text-muted-foreground">
              <div className="py-8">
                <p>Performance, promotions, disciplinary actions, and time tracking will be available here once admin API endpoints are implemented.</p>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
} 