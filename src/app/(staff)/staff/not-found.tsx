import { NotFoundState } from "@/components/shared/route-states"

// notFound() from a staff page (unknown or malformed id, another student's record) renders here, inside the app shell.
export default function StaffNotFound() {
  return <NotFoundState homeHref="/staff/dashboard" />
}
