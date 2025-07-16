import { eq, and, desc, asc, sql, isNull, isNotNull, gte, lte, like, ilike, or, inArray } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface Equipment {
  id: number;
  departmentId: number;
  name: string;
  category: "weapon" | "vehicle" | "radio" | "protective_gear" | "technology" | "other";
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  purchaseDate?: Date;
  warrantyExpiration?: Date;
  condition: "excellent" | "good" | "fair" | "poor" | "damaged" | "out_of_service";
  location?: string;
  isAssignable: boolean;
  requiresTraining: boolean;
  maintenanceSchedule?: string;
  notes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface EquipmentAssignment {
  id: number;
  equipmentId: number;
  memberId: number;
  assignedDate: Date;
  returnDate?: Date;
  assignedCondition: "excellent" | "good" | "fair" | "poor" | "damaged";
  returnCondition?: "excellent" | "good" | "fair" | "poor" | "damaged";
  assignmentNotes?: string;
  returnNotes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface EquipmentMaintenanceRecord {
  id: number;
  equipmentId: number;
  maintenanceType: "routine" | "repair" | "inspection" | "calibration" | "replacement";
  performedDate: Date;
  performedBy: string;
  description: string;
  cost?: number;
  nextMaintenanceDate?: Date;
  notes?: string;
  createdAt: Date;
}

export async function manageEquipment(
  action: "assign" | "return" | "maintenance" | "create" | "update",
  params: any
): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    switch (action) {
      case "assign":
        return await assignEquipment(params);
      case "return":
        return await returnEquipment(params);
      case "maintenance":
        return await recordMaintenance(params);
      case "create":
        return await createEquipment(params);
      case "update":
        return await updateEquipment(params);
      default:
        return {
          success: false,
          message: "Invalid equipment management action",
        };
    }
  } catch (error) {
    console.error(`Equipment management error (${action}):`, error);
    return {
      success: false,
      message: `Failed to ${action} equipment: ${error}`,
    };
  }
}

async function assignEquipment(params: {
  memberId: number;
  equipmentId: number;
  assignedDate?: Date;
  condition?: "excellent" | "good" | "fair" | "poor" | "damaged";
  notes?: string;
}): Promise<{ success: boolean; message: string; data?: any }> {
  const { memberId, equipmentId, assignedDate = new Date(), condition = "good", notes } = params;

  // Check if equipment exists and is available
  const equipment = await getEquipmentById(equipmentId);
  if (!equipment) {
    return {
      success: false,
      message: "Equipment not found",
    };
  }

  if (!equipment.isAssignable) {
    return {
      success: false,
      message: "Equipment is not assignable",
    };
  }

  if (!equipment.isActive) {
    return {
      success: false,
      message: "Equipment is not active",
    };
  }

  // Check if equipment is already assigned
  const existingAssignment = await getCurrentAssignment(equipmentId);
  if (existingAssignment) {
    return {
      success: false,
      message: "Equipment is already assigned to another member",
    };
  }

  // Validate member exists and is active
  const member = await postgrestDb
    .select({
      id: deptSchema.departmentMembers.id,
      isActive: deptSchema.departmentMembers.isActive,
      departmentId: deptSchema.departmentMembers.departmentId,
    })
    .from(deptSchema.departmentMembers)
    .where(eq(deptSchema.departmentMembers.id, memberId))
    .limit(1);

  if (member.length === 0) {
    return {
      success: false,
      message: "Member not found",
    };
  }

  if (!member[0]!.isActive) {
    return {
      success: false,
      message: "Cannot assign equipment to inactive member",
    };
  }

  // Check if member's department matches equipment's department
  if (member[0]!.departmentId !== equipment.departmentId) {
    return {
      success: false,
      message: "Member and equipment must be in the same department",
    };
  }

  // Check if member has required training for this equipment
  if (equipment.requiresTraining) {
    const hasTraining = await checkMemberTraining(memberId, equipmentId);
    if (!hasTraining) {
      return {
        success: false,
        message: "Member does not have required training for this equipment",
      };
    }
  }

  // Create assignment record in database
  const [newAssignment] = await postgrestDb
    .insert(deptSchema.departmentEquipmentAssignments)
    .values({
      equipmentId,
      memberId,
      assignedDate,
      assignedCondition: condition,
      assignmentNotes: notes,
      assignedBy: memberId, // For now, assume self-assignment; could be passed as parameter
      isActive: true,
    })
    .returning({
      id: deptSchema.departmentEquipmentAssignments.id
    });

  if (!newAssignment) {
    return {
      success: false,
      message: "Failed to create equipment assignment",
    };
  }

  return {
    success: true,
    message: "Equipment assigned successfully",
    data: { assignmentId: newAssignment.id },
  };
}

async function returnEquipment(params: {
  assignmentId: number;
  returnCondition: "excellent" | "good" | "fair" | "poor" | "damaged";
  returnNotes?: string;
  returnedBy?: number;
}): Promise<{ success: boolean; message: string; data?: any }> {
  const { assignmentId, returnCondition, returnNotes, returnedBy } = params;

  // Get assignment details from database
  const assignment = await getAssignmentById(assignmentId);
  if (!assignment) {
    return {
      success: false,
      message: "Assignment not found",
    };
  }

  if (!assignment.isActive) {
    return {
      success: false,
      message: "Assignment is already closed",
    };
  }

  // Update assignment record in database
  const result = await postgrestDb
    .update(deptSchema.departmentEquipmentAssignments)
    .set({
      returnDate: new Date(),
      returnCondition,
      returnNotes,
      returnedBy,
      isActive: false,
    })
    .where(eq(deptSchema.departmentEquipmentAssignments.id, assignmentId))
    .returning({ id: deptSchema.departmentEquipmentAssignments.id });

  if (result.length === 0) {
    return {
      success: false,
      message: "Failed to update equipment return",
    };
  }

  // If equipment condition has deteriorated, create maintenance record
  if (shouldScheduleMaintenance(assignment.assignedCondition, returnCondition)) {
    await scheduleMaintenanceForCondition(assignment.equipmentId, returnCondition);
  }

  return {
    success: true,
    message: "Equipment returned successfully",
  };
}

async function recordMaintenance(params: {
  equipmentId: number;
  maintenanceType: "routine" | "repair" | "inspection" | "calibration" | "replacement";
  performedBy: string;
  description: string;
  cost?: number;
  nextMaintenanceDate?: Date;
  notes?: string;
}): Promise<{ success: boolean; message: string; data?: any }> {
  // Validate equipment exists
  const equipment = await getEquipmentById(params.equipmentId);
  if (!equipment) {
    return {
      success: false,
      message: "Equipment not found",
    };
  }

  // Create maintenance record in database
  const [newMaintenance] = await postgrestDb
    .insert(deptSchema.departmentEquipmentMaintenance)
    .values({
      equipmentId: params.equipmentId,
      maintenanceType: params.maintenanceType,
      performedBy: params.performedBy,
      description: params.description,
      cost: params.cost,
      nextMaintenanceDate: params.nextMaintenanceDate,
      notes: params.notes,
      performedDate: new Date(),
    })
    .returning({
      id: deptSchema.departmentEquipmentMaintenance.id
    });

  if (!newMaintenance) {
    return {
      success: false,
      message: "Failed to create maintenance record",
    };
  }

  return {
    success: true,
    message: "Maintenance record created successfully",
    data: { maintenanceId: newMaintenance.id },
  };
}

async function createEquipment(params: {
  departmentId: number;
  name: string;
  category: "weapon" | "vehicle" | "radio" | "protective_gear" | "technology" | "other";
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  purchaseDate?: Date;
  warrantyExpiration?: Date;
  condition?: "excellent" | "good" | "fair" | "poor" | "damaged" | "out_of_service";
  location?: string;
  isAssignable?: boolean;
  requiresTraining?: boolean;
  maintenanceSchedule?: string;
  notes?: string;
}): Promise<{ success: boolean; message: string; data?: any }> {
  // Validate department exists
  const [department] = await postgrestDb
    .select({ id: deptSchema.departments.id })
    .from(deptSchema.departments)
    .where(eq(deptSchema.departments.id, params.departmentId))
    .limit(1);

  if (!department) {
    return {
      success: false,
      message: "Department not found",
    };
  }

  // Check if serial number is unique (if provided)
  if (params.serialNumber) {
    const existingEquipment = await postgrestDb
      .select({ id: deptSchema.departmentEquipment.id })
      .from(deptSchema.departmentEquipment)
      .where(
        and(
          eq(deptSchema.departmentEquipment.serialNumber, params.serialNumber),
          eq(deptSchema.departmentEquipment.departmentId, params.departmentId),
          eq(deptSchema.departmentEquipment.isActive, true)
        )
      )
      .limit(1);

    if (existingEquipment.length > 0) {
      return {
        success: false,
        message: "Equipment with this serial number already exists in the department",
      };
    }
  }

  // Create equipment record in database
  const [newEquipment] = await postgrestDb
    .insert(deptSchema.departmentEquipment)
    .values({
      departmentId: params.departmentId,
      name: params.name,
      category: params.category,
      serialNumber: params.serialNumber,
      model: params.model,
      manufacturer: params.manufacturer,
      purchaseDate: params.purchaseDate,
      warrantyExpiration: params.warrantyExpiration,
      condition: params.condition ?? "good",
      location: params.location,
      isAssignable: params.isAssignable ?? true,
      requiresTraining: params.requiresTraining ?? false,
      maintenanceSchedule: params.maintenanceSchedule,
      notes: params.notes,
      isActive: true,
    })
    .returning({
      id: deptSchema.departmentEquipment.id
    });

  if (!newEquipment) {
    return {
      success: false,
      message: "Failed to create equipment",
    };
  }

  return {
    success: true,
    message: "Equipment created successfully",
    data: { equipmentId: newEquipment.id },
  };
}

async function updateEquipment(params: {
  equipmentId: number;
  updates: Partial<Equipment>;
}): Promise<{ success: boolean; message: string; data?: any }> {
  const { equipmentId, updates } = params;

  const equipment = await getEquipmentById(equipmentId);
  if (!equipment) {
    return {
      success: false,
      message: "Equipment not found",
    };
  }

  // Check if serial number is unique (if being updated)
  if (updates.serialNumber && updates.serialNumber !== equipment.serialNumber) {
    const existingEquipment = await postgrestDb
      .select({ id: deptSchema.departmentEquipment.id })
      .from(deptSchema.departmentEquipment)
      .where(
        and(
          eq(deptSchema.departmentEquipment.serialNumber, updates.serialNumber),
          eq(deptSchema.departmentEquipment.departmentId, equipment.departmentId),
          eq(deptSchema.departmentEquipment.isActive, true)
        )
      )
      .limit(1);

    if (existingEquipment.length > 0) {
      return {
        success: false,
        message: "Equipment with this serial number already exists in the department",
      };
    }
  }

  // Prepare update data
  const updateData: any = {};
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.category !== undefined) updateData.category = updates.category;
  if (updates.serialNumber !== undefined) updateData.serialNumber = updates.serialNumber;
  if (updates.model !== undefined) updateData.model = updates.model;
  if (updates.manufacturer !== undefined) updateData.manufacturer = updates.manufacturer;
  if (updates.purchaseDate !== undefined) updateData.purchaseDate = updates.purchaseDate;
  if (updates.warrantyExpiration !== undefined) updateData.warrantyExpiration = updates.warrantyExpiration;
  if (updates.condition !== undefined) updateData.condition = updates.condition;
  if (updates.location !== undefined) updateData.location = updates.location;
  if (updates.isAssignable !== undefined) updateData.isAssignable = updates.isAssignable;
  if (updates.requiresTraining !== undefined) updateData.requiresTraining = updates.requiresTraining;
  if (updates.maintenanceSchedule !== undefined) updateData.maintenanceSchedule = updates.maintenanceSchedule;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

  // Update equipment in database
  const result = await postgrestDb
    .update(deptSchema.departmentEquipment)
    .set(updateData)
    .where(eq(deptSchema.departmentEquipment.id, equipmentId))
    .returning({ id: deptSchema.departmentEquipment.id });

  if (result.length === 0) {
    return {
      success: false,
      message: "Failed to update equipment",
    };
  }

  return {
    success: true,
    message: "Equipment updated successfully",
  };
}

// Helper functions (placeholders - would query actual tables)

async function getEquipmentById(equipmentId: number): Promise<Equipment | null> {
  try {
    const [equipment] = await postgrestDb
      .select({
        id: deptSchema.departmentEquipment.id,
        departmentId: deptSchema.departmentEquipment.departmentId,
        name: deptSchema.departmentEquipment.name,
        category: deptSchema.departmentEquipment.category,
        serialNumber: deptSchema.departmentEquipment.serialNumber,
        model: deptSchema.departmentEquipment.model,
        manufacturer: deptSchema.departmentEquipment.manufacturer,
        purchaseDate: deptSchema.departmentEquipment.purchaseDate,
        warrantyExpiration: deptSchema.departmentEquipment.warrantyExpiration,
        condition: deptSchema.departmentEquipment.condition,
        location: deptSchema.departmentEquipment.location,
        isAssignable: deptSchema.departmentEquipment.isAssignable,
        requiresTraining: deptSchema.departmentEquipment.requiresTraining,
        maintenanceSchedule: deptSchema.departmentEquipment.maintenanceSchedule,
        notes: deptSchema.departmentEquipment.notes,
        isActive: deptSchema.departmentEquipment.isActive,
        createdAt: deptSchema.departmentEquipment.createdAt,
        updatedAt: deptSchema.departmentEquipment.updatedAt,
      })
      .from(deptSchema.departmentEquipment)
      .where(eq(deptSchema.departmentEquipment.id, equipmentId))
      .limit(1);

    if (!equipment) return null;

    return {
      id: equipment.id,
      departmentId: equipment.departmentId,
      name: equipment.name,
      category: equipment.category as Equipment['category'],
      serialNumber: equipment.serialNumber || undefined,
      model: equipment.model || undefined,
      manufacturer: equipment.manufacturer || undefined,
      purchaseDate: equipment.purchaseDate || undefined,
      warrantyExpiration: equipment.warrantyExpiration || undefined,
      condition: equipment.condition as Equipment['condition'],
      location: equipment.location || undefined,
      isAssignable: equipment.isAssignable,
      requiresTraining: equipment.requiresTraining,
      maintenanceSchedule: equipment.maintenanceSchedule || undefined,
      notes: equipment.notes || undefined,
      isActive: equipment.isActive,
      createdAt: equipment.createdAt,
      updatedAt: equipment.updatedAt || undefined,
    };
  } catch (error) {
    console.error("Error getting equipment by ID:", error);
    return null;
  }
}

async function getCurrentAssignment(equipmentId: number): Promise<EquipmentAssignment | null> {
  try {
    const [assignment] = await postgrestDb
      .select({
        id: deptSchema.departmentEquipmentAssignments.id,
        equipmentId: deptSchema.departmentEquipmentAssignments.equipmentId,
        memberId: deptSchema.departmentEquipmentAssignments.memberId,
        assignedDate: deptSchema.departmentEquipmentAssignments.assignedDate,
        returnDate: deptSchema.departmentEquipmentAssignments.returnDate,
        assignedCondition: deptSchema.departmentEquipmentAssignments.assignedCondition,
        returnCondition: deptSchema.departmentEquipmentAssignments.returnCondition,
        assignmentNotes: deptSchema.departmentEquipmentAssignments.assignmentNotes,
        returnNotes: deptSchema.departmentEquipmentAssignments.returnNotes,
        isActive: deptSchema.departmentEquipmentAssignments.isActive,
        createdAt: deptSchema.departmentEquipmentAssignments.createdAt,
        updatedAt: deptSchema.departmentEquipmentAssignments.updatedAt,
      })
      .from(deptSchema.departmentEquipmentAssignments)
      .where(
        and(
          eq(deptSchema.departmentEquipmentAssignments.equipmentId, equipmentId),
          eq(deptSchema.departmentEquipmentAssignments.isActive, true)
        )
      )
      .limit(1);

    if (!assignment) return null;

    return {
      id: assignment.id,
      equipmentId: assignment.equipmentId,
      memberId: assignment.memberId,
      assignedDate: assignment.assignedDate,
      returnDate: assignment.returnDate || undefined,
      assignedCondition: assignment.assignedCondition as EquipmentAssignment['assignedCondition'],
      returnCondition: assignment.returnCondition as EquipmentAssignment['returnCondition'] || undefined,
      assignmentNotes: assignment.assignmentNotes || undefined,
      returnNotes: assignment.returnNotes || undefined,
      isActive: assignment.isActive,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt || undefined,
    };
  } catch (error) {
    console.error("Error getting current assignment:", error);
    return null;
  }
}

async function getAssignmentById(assignmentId: number): Promise<EquipmentAssignment | null> {
  try {
    const [assignment] = await postgrestDb
      .select({
        id: deptSchema.departmentEquipmentAssignments.id,
        equipmentId: deptSchema.departmentEquipmentAssignments.equipmentId,
        memberId: deptSchema.departmentEquipmentAssignments.memberId,
        assignedDate: deptSchema.departmentEquipmentAssignments.assignedDate,
        returnDate: deptSchema.departmentEquipmentAssignments.returnDate,
        assignedCondition: deptSchema.departmentEquipmentAssignments.assignedCondition,
        returnCondition: deptSchema.departmentEquipmentAssignments.returnCondition,
        assignmentNotes: deptSchema.departmentEquipmentAssignments.assignmentNotes,
        returnNotes: deptSchema.departmentEquipmentAssignments.returnNotes,
        isActive: deptSchema.departmentEquipmentAssignments.isActive,
        createdAt: deptSchema.departmentEquipmentAssignments.createdAt,
        updatedAt: deptSchema.departmentEquipmentAssignments.updatedAt,
      })
      .from(deptSchema.departmentEquipmentAssignments)
      .where(eq(deptSchema.departmentEquipmentAssignments.id, assignmentId))
      .limit(1);

    if (!assignment) return null;

    return {
      id: assignment.id,
      equipmentId: assignment.equipmentId,
      memberId: assignment.memberId,
      assignedDate: assignment.assignedDate,
      returnDate: assignment.returnDate || undefined,
      assignedCondition: assignment.assignedCondition as EquipmentAssignment['assignedCondition'],
      returnCondition: assignment.returnCondition as EquipmentAssignment['returnCondition'] || undefined,
      assignmentNotes: assignment.assignmentNotes || undefined,
      returnNotes: assignment.returnNotes || undefined,
      isActive: assignment.isActive,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt || undefined,
    };
  } catch (error) {
    console.error("Error getting assignment by ID:", error);
    return null;
  }
}

async function checkMemberTraining(memberId: number, equipmentId: number): Promise<boolean> {
  try {
    // Get equipment details to check if training is required
    const equipment = await getEquipmentById(equipmentId);
    if (!equipment || !equipment.requiresTraining) {
      return true; // No training required
    }

    // For now, we'll implement a basic check
    // In a real system, you'd check against specific certifications required for equipment categories
    // This could be expanded to check departmentMemberCertifications table
    const memberCertifications = await postgrestDb
      .select({
        id: deptSchema.departmentMemberCertifications.id,
        certificationId: deptSchema.departmentMemberCertifications.certificationId,
      })
      .from(deptSchema.departmentMemberCertifications)
      .where(eq(deptSchema.departmentMemberCertifications.memberId, memberId));

    // For now, assume member has training if they have any certifications
    // This should be enhanced to check for specific equipment-related certifications
    return memberCertifications.length > 0;
  } catch (error) {
    console.error("Error checking member training:", error);
    return false; // Err on the side of caution
  }
}

function shouldScheduleMaintenance(
  assignedCondition: string,
  returnCondition: string
): boolean {
  const conditionValues = {
    excellent: 5,
    good: 4,
    fair: 3,
    poor: 2,
    damaged: 1,
  };

  const assigned = conditionValues[assignedCondition as keyof typeof conditionValues] ?? 4;
  const returned = conditionValues[returnCondition as keyof typeof conditionValues] ?? 4;

  // Schedule maintenance if condition deteriorated by 2+ levels or is poor/damaged
  return (assigned - returned >= 2) || returned <= 2;
}

async function scheduleMaintenanceForCondition(
  equipmentId: number,
  condition: string
): Promise<void> {
  const maintenanceType = condition === "damaged" ? "repair" : "inspection";

  await recordMaintenance({
    equipmentId,
    maintenanceType,
    performedBy: "System",
    description: `Scheduled due to equipment condition: ${condition}`,
    notes: "Auto-scheduled maintenance based on return condition",
  });
}

export async function getEquipmentInventory(departmentId: number): Promise<{
  total: number;
  available: number;
  assigned: number;
  maintenance: number;
  byCategory: Record<string, number>;
  byCondition: Record<string, number>;
}> {
  try {
    // Get all equipment for the department
    const equipment = await postgrestDb
      .select({
        id: deptSchema.departmentEquipment.id,
        category: deptSchema.departmentEquipment.category,
        condition: deptSchema.departmentEquipment.condition,
        isActive: deptSchema.departmentEquipment.isActive,
      })
      .from(deptSchema.departmentEquipment)
      .where(
        and(
          eq(deptSchema.departmentEquipment.departmentId, departmentId),
          eq(deptSchema.departmentEquipment.isActive, true)
        )
      );

    // Get active assignments
    const activeAssignments = await postgrestDb
      .select({
        equipmentId: deptSchema.departmentEquipmentAssignments.equipmentId,
      })
      .from(deptSchema.departmentEquipmentAssignments)
      .innerJoin(
        deptSchema.departmentEquipment,
        eq(deptSchema.departmentEquipmentAssignments.equipmentId, deptSchema.departmentEquipment.id)
      )
      .where(
        and(
          eq(deptSchema.departmentEquipment.departmentId, departmentId),
          eq(deptSchema.departmentEquipmentAssignments.isActive, true)
        )
      );

    const assignedEquipmentIds = new Set(activeAssignments.map(a => a.equipmentId));

    // Calculate statistics
    const total = equipment.length;
    const assigned = assignedEquipmentIds.size;
    const maintenance = equipment.filter(e => e.condition === "out_of_service").length;
    const available = total - assigned - maintenance;

    // Count by category
    const byCategory: Record<string, number> = {
      weapon: 0,
      vehicle: 0,
      radio: 0,
      protective_gear: 0,
      technology: 0,
      other: 0,
    };

    // Count by condition
    const byCondition: Record<string, number> = {
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0,
      damaged: 0,
      out_of_service: 0,
    };

    for (const item of equipment) {
      byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      byCondition[item.condition] = (byCondition[item.condition] || 0) + 1;
    }

    return {
      total,
      available,
      assigned,
      maintenance,
      byCategory,
      byCondition,
    };
  } catch (error) {
    console.error("Error getting equipment inventory:", error);
    return {
      total: 0,
      available: 0,
      assigned: 0,
      maintenance: 0,
      byCategory: {},
      byCondition: {},
    };
  }
}

export async function getEquipmentMaintenanceSchedule(
  departmentId: number,
  daysAhead: number = 30
): Promise<Array<{
  equipmentId: number;
  equipmentName: string;
  maintenanceType: string;
  scheduledDate: Date;
  priority: "low" | "medium" | "high";
}>> {
  try {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    // Get maintenance records with next maintenance dates
    const maintenanceSchedule = await postgrestDb
      .select({
        equipmentId: deptSchema.departmentEquipmentMaintenance.equipmentId,
        maintenanceType: deptSchema.departmentEquipmentMaintenance.maintenanceType,
        nextMaintenanceDate: deptSchema.departmentEquipmentMaintenance.nextMaintenanceDate,
        equipmentName: deptSchema.departmentEquipment.name,
        equipmentCondition: deptSchema.departmentEquipment.condition,
      })
      .from(deptSchema.departmentEquipmentMaintenance)
      .innerJoin(
        deptSchema.departmentEquipment,
        eq(deptSchema.departmentEquipmentMaintenance.equipmentId, deptSchema.departmentEquipment.id)
      )
      .where(
        and(
          eq(deptSchema.departmentEquipment.departmentId, departmentId),
          eq(deptSchema.departmentEquipment.isActive, true),
          isNotNull(deptSchema.departmentEquipmentMaintenance.nextMaintenanceDate),
          lte(deptSchema.departmentEquipmentMaintenance.nextMaintenanceDate, endDate)
        )
      )
      .orderBy(asc(deptSchema.departmentEquipmentMaintenance.nextMaintenanceDate));

    // Also get equipment that needs maintenance based on condition
    const equipmentNeedingMaintenance = await postgrestDb
      .select({
        id: deptSchema.departmentEquipment.id,
        name: deptSchema.departmentEquipment.name,
        condition: deptSchema.departmentEquipment.condition,
        createdAt: deptSchema.departmentEquipment.createdAt,
      })
      .from(deptSchema.departmentEquipment)
      .where(
        and(
          eq(deptSchema.departmentEquipment.departmentId, departmentId),
          eq(deptSchema.departmentEquipment.isActive, true),
          or(
            eq(deptSchema.departmentEquipment.condition, "poor"),
            eq(deptSchema.departmentEquipment.condition, "damaged")
          )
        )
      );

    const schedule: Array<{
      equipmentId: number;
      equipmentName: string;
      maintenanceType: string;
      scheduledDate: Date;
      priority: "low" | "medium" | "high";
    }> = [];

    // Add scheduled maintenance
    for (const item of maintenanceSchedule) {
      if (item.nextMaintenanceDate) {
        const priority = determinePriority(item.equipmentCondition, item.nextMaintenanceDate);
        schedule.push({
          equipmentId: item.equipmentId,
          equipmentName: item.equipmentName,
          maintenanceType: item.maintenanceType,
          scheduledDate: item.nextMaintenanceDate,
          priority,
        });
      }
    }

    // Add equipment needing immediate maintenance based on condition
    for (const equipment of equipmentNeedingMaintenance) {
      // Check if already in schedule
      const alreadyScheduled = schedule.some(s => s.equipmentId === equipment.id);
      if (!alreadyScheduled) {
        const maintenanceType = equipment.condition === "damaged" ? "repair" : "inspection";
        const scheduledDate = new Date(); // Immediate
        const priority = equipment.condition === "damaged" ? "high" : "medium";

        schedule.push({
          equipmentId: equipment.id,
          equipmentName: equipment.name,
          maintenanceType,
          scheduledDate,
          priority,
        });
      }
    }

    // Sort by priority and date
    return schedule.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.scheduledDate.getTime() - b.scheduledDate.getTime();
    });
  } catch (error) {
    console.error("Error getting equipment maintenance schedule:", error);
    return [];
  }
}

function determinePriority(
  condition: string,
  scheduledDate: Date
): "low" | "medium" | "high" {
  const now = new Date();
  const daysUntilMaintenance = Math.ceil(
    (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // High priority: damaged equipment or overdue maintenance
  if (condition === "damaged" || daysUntilMaintenance < 0) {
    return "high";
  }

  // Medium priority: poor condition or maintenance due within 7 days
  if (condition === "poor" || daysUntilMaintenance <= 7) {
    return "medium";
  }

  // Low priority: everything else
  return "low";
}

// Additional utility functions for equipment management

export async function searchEquipment(params: {
  departmentId: number;
  searchTerm?: string;
  category?: string;
  condition?: string;
  isAssignable?: boolean;
  isAssigned?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{
  equipment: Equipment[];
  total: number;
}> {
  try {
    const {
      departmentId,
      searchTerm,
      category,
      condition,
      isAssignable,
      isAssigned,
      limit = 50,
      offset = 0,
    } = params;

    // Build where conditions
    const conditions = [
      eq(deptSchema.departmentEquipment.departmentId, departmentId),
      eq(deptSchema.departmentEquipment.isActive, true),
    ];

    if (searchTerm && typeof searchTerm === "string" && searchTerm.trim() !== "") {
      const term = `%${searchTerm.trim()}%`;
      const searchCondition = or(
        ilike(deptSchema.departmentEquipment.name, term),
        ilike(deptSchema.departmentEquipment.serialNumber, term),
        ilike(deptSchema.departmentEquipment.model, term),
        ilike(deptSchema.departmentEquipment.manufacturer, term)
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (category) {
      conditions.push(eq(deptSchema.departmentEquipment.category, category as any));
    }

    if (condition) {
      conditions.push(eq(deptSchema.departmentEquipment.condition, condition as any));
    }

    if (isAssignable !== undefined) {
      conditions.push(eq(deptSchema.departmentEquipment.isAssignable, isAssignable));
    }

    // Get total count
    const totalResult = await postgrestDb
      .select({ count: sql<number>`count(*)` })
      .from(deptSchema.departmentEquipment)
      .where(and(...conditions));

    const total = totalResult[0]?.count || 0;

    // Get equipment with pagination
    let query = postgrestDb
      .select({
        id: deptSchema.departmentEquipment.id,
        departmentId: deptSchema.departmentEquipment.departmentId,
        name: deptSchema.departmentEquipment.name,
        category: deptSchema.departmentEquipment.category,
        serialNumber: deptSchema.departmentEquipment.serialNumber,
        model: deptSchema.departmentEquipment.model,
        manufacturer: deptSchema.departmentEquipment.manufacturer,
        purchaseDate: deptSchema.departmentEquipment.purchaseDate,
        warrantyExpiration: deptSchema.departmentEquipment.warrantyExpiration,
        condition: deptSchema.departmentEquipment.condition,
        location: deptSchema.departmentEquipment.location,
        isAssignable: deptSchema.departmentEquipment.isAssignable,
        requiresTraining: deptSchema.departmentEquipment.requiresTraining,
        maintenanceSchedule: deptSchema.departmentEquipment.maintenanceSchedule,
        notes: deptSchema.departmentEquipment.notes,
        isActive: deptSchema.departmentEquipment.isActive,
        createdAt: deptSchema.departmentEquipment.createdAt,
        updatedAt: deptSchema.departmentEquipment.updatedAt,
      })
      .from(deptSchema.departmentEquipment)
      .where(and(...conditions))
      .orderBy(desc(deptSchema.departmentEquipment.createdAt))
      .limit(limit)
      .offset(offset);

    // If filtering by assignment status, we need to join with assignments
    if (isAssigned !== undefined) {
      if (isAssigned) {
        // Only show assigned equipment
        query = query
          .innerJoin(
            deptSchema.departmentEquipmentAssignments,
            and(
              eq(deptSchema.departmentEquipmentAssignments.equipmentId, deptSchema.departmentEquipment.id),
              eq(deptSchema.departmentEquipmentAssignments.isActive, true)
            )
          );
      } else {
        // Only show unassigned equipment - this is more complex, need to use NOT EXISTS
        const assignedEquipmentIds = await postgrestDb
          .select({ equipmentId: deptSchema.departmentEquipmentAssignments.equipmentId })
          .from(deptSchema.departmentEquipmentAssignments)
          .where(eq(deptSchema.departmentEquipmentAssignments.isActive, true));

        const assignedIds = assignedEquipmentIds.map(a => a.equipmentId);
        if (assignedIds.length > 0) {
          conditions.push(sql`${deptSchema.departmentEquipment.id} NOT IN (${assignedIds.join(',')})`);
        }
      }
    }

    const equipmentResults = await query;

    const equipment: Equipment[] = equipmentResults.map(item => ({
      id: item.id,
      departmentId: item.departmentId,
      name: item.name,
      category: item.category as Equipment['category'],
      serialNumber: item.serialNumber || undefined,
      model: item.model || undefined,
      manufacturer: item.manufacturer || undefined,
      purchaseDate: item.purchaseDate || undefined,
      warrantyExpiration: item.warrantyExpiration || undefined,
      condition: item.condition as Equipment['condition'],
      location: item.location || undefined,
      isAssignable: item.isAssignable,
      requiresTraining: item.requiresTraining,
      maintenanceSchedule: item.maintenanceSchedule || undefined,
      notes: item.notes || undefined,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt || undefined,
    }));

    return {
      equipment,
      total,
    };
  } catch (error) {
    console.error("Error searching equipment:", error);
    return {
      equipment: [],
      total: 0,
    };
  }
}

export async function getEquipmentAssignments(params: {
  departmentId?: number;
  memberId?: number;
  equipmentId?: number;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{
  assignments: (EquipmentAssignment & {
    equipmentName: string;
    memberName?: string;
  })[];
  total: number;
}> {
  try {
    const {
      departmentId,
      memberId,
      equipmentId,
      isActive,
      limit = 50,
      offset = 0,
    } = params;

    // Build where conditions
    const conditions = [];

    if (departmentId) {
      conditions.push(eq(deptSchema.departmentEquipment.departmentId, departmentId));
    }

    if (memberId) {
      conditions.push(eq(deptSchema.departmentEquipmentAssignments.memberId, memberId));
    }

    if (equipmentId) {
      conditions.push(eq(deptSchema.departmentEquipmentAssignments.equipmentId, equipmentId));
    }

    if (isActive !== undefined) {
      conditions.push(eq(deptSchema.departmentEquipmentAssignments.isActive, isActive));
    }

    // Get total count
    const totalResult = await postgrestDb
      .select({ count: sql<number>`count(*)` })
      .from(deptSchema.departmentEquipmentAssignments)
      .innerJoin(
        deptSchema.departmentEquipment,
        eq(deptSchema.departmentEquipmentAssignments.equipmentId, deptSchema.departmentEquipment.id)
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = totalResult[0]?.count || 0;

    // Get assignments with equipment and member details
    const assignmentResults = await postgrestDb
      .select({
        id: deptSchema.departmentEquipmentAssignments.id,
        equipmentId: deptSchema.departmentEquipmentAssignments.equipmentId,
        memberId: deptSchema.departmentEquipmentAssignments.memberId,
        assignedDate: deptSchema.departmentEquipmentAssignments.assignedDate,
        returnDate: deptSchema.departmentEquipmentAssignments.returnDate,
        assignedCondition: deptSchema.departmentEquipmentAssignments.assignedCondition,
        returnCondition: deptSchema.departmentEquipmentAssignments.returnCondition,
        assignmentNotes: deptSchema.departmentEquipmentAssignments.assignmentNotes,
        returnNotes: deptSchema.departmentEquipmentAssignments.returnNotes,
        isActive: deptSchema.departmentEquipmentAssignments.isActive,
        createdAt: deptSchema.departmentEquipmentAssignments.createdAt,
        updatedAt: deptSchema.departmentEquipmentAssignments.updatedAt,
        equipmentName: deptSchema.departmentEquipment.name,
        memberName: deptSchema.departmentMembers.roleplayName,
      })
      .from(deptSchema.departmentEquipmentAssignments)
      .innerJoin(
        deptSchema.departmentEquipment,
        eq(deptSchema.departmentEquipmentAssignments.equipmentId, deptSchema.departmentEquipment.id)
      )
      .leftJoin(
        deptSchema.departmentMembers,
        eq(deptSchema.departmentEquipmentAssignments.memberId, deptSchema.departmentMembers.id)
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(deptSchema.departmentEquipmentAssignments.assignedDate))
      .limit(limit)
      .offset(offset);

    const assignments = assignmentResults.map(item => ({
      id: item.id,
      equipmentId: item.equipmentId,
      memberId: item.memberId,
      assignedDate: item.assignedDate,
      returnDate: item.returnDate || undefined,
      assignedCondition: item.assignedCondition as EquipmentAssignment['assignedCondition'],
      returnCondition: item.returnCondition as EquipmentAssignment['returnCondition'] || undefined,
      assignmentNotes: item.assignmentNotes || undefined,
      returnNotes: item.returnNotes || undefined,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt || undefined,
      equipmentName: item.equipmentName,
      memberName: item.memberName || undefined,
    }));

    return {
      assignments,
      total,
    };
  } catch (error) {
    console.error("Error getting equipment assignments:", error);
    return {
      assignments: [],
      total: 0,
    };
  }
}

export async function getEquipmentMaintenanceHistory(
  equipmentId: number,
  limit: number = 50,
  offset: number = 0
): Promise<{
  maintenanceRecords: EquipmentMaintenanceRecord[];
  total: number;
}> {
  try {
    // Get total count
    const totalResult = await postgrestDb
      .select({ count: sql<number>`count(*)` })
      .from(deptSchema.departmentEquipmentMaintenance)
      .where(eq(deptSchema.departmentEquipmentMaintenance.equipmentId, equipmentId));

    const total = totalResult[0]?.count || 0;

    // Get maintenance records
    const maintenanceResults = await postgrestDb
      .select({
        id: deptSchema.departmentEquipmentMaintenance.id,
        equipmentId: deptSchema.departmentEquipmentMaintenance.equipmentId,
        maintenanceType: deptSchema.departmentEquipmentMaintenance.maintenanceType,
        performedDate: deptSchema.departmentEquipmentMaintenance.performedDate,
        performedBy: deptSchema.departmentEquipmentMaintenance.performedBy,
        description: deptSchema.departmentEquipmentMaintenance.description,
        cost: deptSchema.departmentEquipmentMaintenance.cost,
        nextMaintenanceDate: deptSchema.departmentEquipmentMaintenance.nextMaintenanceDate,
        notes: deptSchema.departmentEquipmentMaintenance.notes,
        createdAt: deptSchema.departmentEquipmentMaintenance.createdAt,
      })
      .from(deptSchema.departmentEquipmentMaintenance)
      .where(eq(deptSchema.departmentEquipmentMaintenance.equipmentId, equipmentId))
      .orderBy(desc(deptSchema.departmentEquipmentMaintenance.performedDate))
      .limit(limit)
      .offset(offset);

    const maintenanceRecords: EquipmentMaintenanceRecord[] = maintenanceResults.map(item => ({
      id: item.id,
      equipmentId: item.equipmentId,
      maintenanceType: item.maintenanceType as EquipmentMaintenanceRecord['maintenanceType'],
      performedDate: item.performedDate,
      performedBy: item.performedBy,
      description: item.description,
      cost: item.cost || undefined,
      nextMaintenanceDate: item.nextMaintenanceDate || undefined,
      notes: item.notes || undefined,
      createdAt: item.createdAt,
    }));

    return {
      maintenanceRecords,
      total,
    };
  } catch (error) {
    console.error("Error getting equipment maintenance history:", error);
    return {
      maintenanceRecords: [],
      total: 0,
    };
  }
}