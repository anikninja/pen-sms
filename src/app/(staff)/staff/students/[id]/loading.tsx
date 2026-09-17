import { PageSkeleton } from "@/components/shared/page-skeleton"

// Needed at this level too: moving from the list to a record keeps the parent segment mounted, so its loading state would not show.
export default function Loading() {
  return <PageSkeleton cards={4} />
}
