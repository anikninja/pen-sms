import { PageSkeleton } from "@/components/shared/page-skeleton"

// Shown inside the app shell while a page's data loads, so the navigation stays usable.
export default function Loading() {
  return <PageSkeleton />
}
