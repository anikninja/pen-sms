import { NotFoundState } from "@/components/shared/route-states"

// Unknown URLs. "/" sends signed-in users to their own dashboard and everyone else to the login page.
export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <NotFoundState homeHref="/" homeLabel="Go to home" />
    </main>
  )
}
