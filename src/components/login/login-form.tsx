"use client"

import { GalleryVerticalEnd } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { signIn } from "@/lib/auth-client"

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const handleDiscordLogin = async () => {
    try {
      await signIn()
      // Handle successful sign-in, e.g., redirect or update UI
      // The signIn function in auth-client.ts currently just logs the data
    } catch (error) {
      console.error("Discord sign-in failed:", error)
      // Handle error, e.g., show a notification to the user
    }
  }

  return (
    <div className={cn("flex min-h-screen flex-col items-center justify-center", className)} {...props}>
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg border bg-card p-8 text-card-foreground shadow-sm">
        <div className="flex flex-col items-center gap-2">
          <a
            href="#"
            className="flex flex-col items-center gap-2 font-medium"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-6" />
            </div>
            {/* <span className="sr-only">Acme Inc.</span> */}
          </a>
          {/* <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1> */}
          <p className="text-sm text-muted-foreground">
            Sign in with your Discord account to continue
          </p>
        </div>

        <Button onClick={handleDiscordLogin} className="w-full">
          {/* You can add a Discord icon here if you have one */}
          Login with Discord
        </Button>

        <div className="text-balance text-center text-xs text-muted-foreground">
          By clicking continue, you agree to our{" "}
          <a href="#" className="underline underline-offset-4 hover:text-primary">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="underline underline-offset-4 hover:text-primary">
            Privacy Policy
          </a>
          .
        </div>
      </div>
    </div>
  )
}
