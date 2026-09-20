import Image from "next/image"

import { COMPANY, CREDIT } from "@/lib/brand"
import { cn } from "@/lib/utils"

/**
 * The INXAPP Limited credit. Two logo files are shipped because the mark is navy on light and
 * near-white on dark; the unused one is hidden by the `dark` variant rather than swapped at
 * runtime, so there is nothing to hydrate and no flash on first paint.
 */
function Logo({ kind, className }: { kind: "logo" | "mark"; className?: string }) {
  const size = kind === "logo" ? { width: 600, height: 126 } : { width: 160, height: 160 }
  return (
    <>
      <Image src={`/brand/inxapp-${kind}.png`} alt={COMPANY.name} {...size} className={cn(className, "dark:hidden")} priority={false} />
      <Image
        src={`/brand/inxapp-${kind}-dark.png`}
        alt=""
        aria-hidden
        {...size}
        className={cn(className, "hidden dark:block")}
        priority={false}
      />
    </>
  )
}

/** Full credit for the sign-in screen: the lockup, the credit line and the company tagline. */
export function InxappCredit({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <a href={COMPANY.url} target="_blank" rel="noreferrer noopener" className="inline-block">
        <Logo kind="logo" className="h-7 w-auto" />
      </a>
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>{CREDIT}</p>
        <p>
          <span className="font-medium tracking-wide text-foreground/70">{COMPANY.tagline}</span>{" "}
          <a href={COMPANY.url} target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:underline">
            {COMPANY.domain}
          </a>
        </p>
      </div>
    </div>
  )
}

/** One-line credit for the sidebar footer: the square mark and the company name. */
export function InxappCreditCompact({ className }: { className?: string }) {
  return (
    <a
      href={COMPANY.url}
      target="_blank"
      rel="noreferrer noopener"
      title={CREDIT}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
    >
      <Logo kind="mark" className="size-4 shrink-0" />
      <span className="truncate">{CREDIT}</span>
    </a>
  )
}
