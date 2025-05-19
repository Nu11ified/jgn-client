import { createAuthClient } from "better-auth/react"
import { env } from "@/env"

export const authClient = createAuthClient({
    /** The base URL of the server (optional if you're using the same domain) */
    baseURL: env.NEXT_PUBLIC_URL
})

export const signIn = async () => {
    const data = await authClient.signIn.social({
        provider: "discord"
    })
    console.log(data)
}

export const signOut = async () => {
    const data = await authClient.signOut()
    console.log(data)
}