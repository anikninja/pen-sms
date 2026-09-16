"use server"

import { AuthError } from "next-auth"

import { signIn, signOut } from "@/auth"
import { loginSchema } from "@/lib/validations/auth"

export type LoginState = {
  error?: string
  fieldErrors?: { email?: string[]; password?: string[] }
  email?: string
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  const email = String(formData.get("email") ?? "")

  if (!parsed.success) {
    const { fieldErrors } = parsed.error.flatten()
    return { fieldErrors, email }
  }

  try {
    // "/" sends each role to its own dashboard.
    await signIn("credentials", { ...parsed.data, redirectTo: "/" })
    return {}
  } catch (error) {
    if (error instanceof AuthError) {
      // One message for unknown email and wrong password, so accounts can't be discovered.
      return { error: "Invalid email or password.", email }
    }
    throw error // includes the success redirect
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" })
}
