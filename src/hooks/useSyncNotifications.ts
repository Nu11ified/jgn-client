import { toast } from "sonner";
import { useCallback } from "react";

export interface SyncNotificationOptions {
  loadingMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  duration?: number;
}

export interface SyncResult {
  success: boolean;
  message: string;
  details?: {
    rankSync?: { success: boolean; message: string };
    teamSync?: { success: boolean; message: string };
    callsignUpdate?: { success: boolean; message: string };
  };
}

export const useSyncNotifications = () => {
  const showSyncStatus = useCallback((
    syncPromise: Promise<SyncResult>,
    options: SyncNotificationOptions = {}
  ) => {
    const {
      loadingMessage = "Syncing member data in background...",
      successMessage = "Member sync completed successfully",
      errorMessage = "Member sync failed",
      duration = 4000,
    } = options;

    // Show loading toast
    const loadingToastId = toast.loading(loadingMessage, {
      duration: Infinity, // Keep loading toast until resolved
    });

    return syncPromise
      .then((result) => {
        // Dismiss loading toast
        toast.dismiss(loadingToastId);

        if (result.success) {
          // Show success toast
          toast.success(result.message ?? successMessage, {
            duration,
            description: result.details ? getSyncDetailsDescription(result.details) : undefined,
          });
        } else {
          // Show error toast
          toast.error(result.message ?? errorMessage, {
            duration,
            description: result.details ? getSyncDetailsDescription(result.details) : undefined,
          });
        }

        return result;
      })
      .catch((error: unknown) => {
        // Dismiss loading toast
        toast.dismiss(loadingToastId);

        // Show error toast
        toast.error(errorMessage, {
          duration,
          description: error instanceof Error ? error.message : "An unexpected error occurred during sync",
        });

        throw error;
      });
  }, []);

  const showQuickSuccess = useCallback((message: string, description?: string) => {
    toast.success(message, {
      duration: 3000,
      description,
    });
  }, []);

  const showQuickError = useCallback((message: string, description?: string) => {
    toast.error(message, {
      duration: 4000,
      description,
    });
  }, []);

  const showQuickInfo = useCallback((message: string, description?: string) => {
    toast.info(message, {
      duration: 3000,
      description,
    });
  }, []);

  return {
    showSyncStatus,
    showQuickSuccess,
    showQuickError,
    showQuickInfo,
  };
};

// Helper function to create description from sync details
function getSyncDetailsDescription(details: SyncResult['details']): string {
  if (!details) return "";

  const parts: string[] = [];
  
  if (details.rankSync) {
    parts.push(`Rank: ${details.rankSync.success ? "✓" : "✗"} ${details.rankSync.message}`);
  }
  
  if (details.teamSync) {
    parts.push(`Team: ${details.teamSync.success ? "✓" : "✗"} ${details.teamSync.message}`);
  }
  
  if (details.callsignUpdate) {
    parts.push(`Callsign: ${details.callsignUpdate.success ? "✓" : "✗"} ${details.callsignUpdate.message}`);
  }

  return parts.join(" • ");
} 