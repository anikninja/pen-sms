import { NotFoundState } from "@/components/shared/route-states"

// notFound() from a student page (e.g. the signed-in student record no longer exists) renders here, inside the app shell.
export default function StudentNotFound() {
  return <NotFoundState homeHref="/student/dashboard" />
}
