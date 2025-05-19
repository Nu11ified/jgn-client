import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/user-schema";
import { eq, and } from "drizzle-orm";
import { account } from "@/server/db/schema/auth-schema";
 
export async function middleware(request: NextRequest) {
	const sessionCookie = getSessionCookie(request);
 
	if (!sessionCookie) {
		return NextResponse.redirect(new URL("/auth/login", request.url));
	}

	// Check for admin access if trying to access admin routes
	if (request.nextUrl.pathname.startsWith("/admin")) {
		try {
			// Get the session data from the cookie
			const session = await auth.api.getSession({
				headers: request.headers
			});
			
			if (!session?.user?.id) {
				return NextResponse.redirect(new URL("/auth/login", request.url));
			}

			// Get the Discord account ID from the auth session
			const accountRecord = await db
				.select()
				.from(account)
				.where(
					and(
						eq(account.userId, session.user.id),
						eq(account.providerId, "discord")
					)
				)
				.limit(1)
				.then((res) => res[0]);

			if (!accountRecord?.accountId) {
				return NextResponse.redirect(new URL("/", request.url));
			}

			// Check if the user is an admin
			const discordIdBigInt = BigInt(accountRecord.accountId);
			const userRecord = await db
				.select()
				.from(users)
				.where(eq(users.discordId, discordIdBigInt))
				.limit(1)
				.then((res) => res[0]);

			if (!userRecord?.isAdmin) {
				return NextResponse.redirect(new URL("/", request.url));
			}
		} catch (error) {
			console.error("Error in admin middleware check:", error);
			return NextResponse.redirect(new URL("/", request.url));
		}
	}
 
	return NextResponse.next();
}
 
export const config = {
	matcher: ["/dashboard/:path*", "/admin/:path*"], // Added admin routes to the matcher
};