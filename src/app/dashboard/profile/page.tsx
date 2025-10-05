import { api, HydrateClient } from "@/trpc/server";
import UserProfileDisplay from "@/app/_components/dashboard/profile/UserProfileDisplay";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, ArrowLeft } from "lucide-react";

// This page will pre-fetch data on the server and pass it to the client component.

// If you have a layout file for the dashboard, ensure it handles session checks
// or use protectedProcedure if this page itself should be protected directly.
// For now, assuming session/auth is handled by middleware or a layout.

export default async function UserProfilePage() {
  // Server-side data fetching using the server helper
  // The `api` here is from `@/trpc/server`
  try {
    console.log('[PROFILE PAGE] Fetching user profile...');
    const user = await api.user.getMe();
    console.log('[PROFILE PAGE] User profile fetched successfully:', user?.discordId);
    
    // Additional validation to ensure user has required fields
    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User profile not found. Please ensure you are logged in.'
      });
    }
    
    // `HydrateClient` is used to pass server-fetched data to client components,
    // ensuring that React Query on the client side starts with this data already cached.
    return (
      <HydrateClient>
        <div className="container mx-auto min-h-screen py-12 px-4 md:px-6 lg:px-8 flex flex-col items-center">
          <div className="w-full max-w-3xl">
            <div className="mb-8 flex items-center justify-between">
              <h1 className="text-4xl font-bold tracking-tight">
                Your Profile
              </h1>
              <Button variant="outline" asChild>
                <Link href="/dashboard">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Dashboard
                </Link>
              </Button>
            </div>
            <UserProfileDisplay user={user} />
          </div>
        </div>
      </HydrateClient>
    );
  } catch (error) {
    console.error('[PROFILE PAGE ERROR]:', error);
    let title = "Error Loading Profile";
    let message = "An unknown error occurred while loading your profile.";

    if (error instanceof TRPCError) {
      if (error.code === "UNAUTHORIZED") {
        title = "Unauthorized Access";
        message = "You must be logged in to view this page. Please log in and try again.";
      } else {
        message = error.message;
      }
    }
    console.error(`${title}:`, error);

    return (
      <div className="container mx-auto min-h-screen py-12 px-4 md:px-6 lg:px-8 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <Alert variant="destructive" className="shadow-lg">
            <AlertCircle className="h-5 w-5" />
            <AlertTitle className="text-xl font-semibold">{title}</AlertTitle>
            <AlertDescription className="mt-2">
              {message}
            </AlertDescription>
            <div className="mt-6 flex justify-end gap-3">
                <Button variant="outline" asChild>
                    <Link href="/dashboard">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Go to Dashboard
                    </Link>
                </Button>
                {error instanceof TRPCError && error.code === "UNAUTHORIZED" && (
                    <Button asChild>
                        <Link href="/auth/login">Login</Link>
                    </Button>
                )}
            </div>
          </Alert>
        </div>
      </div>
    );
  }
} 