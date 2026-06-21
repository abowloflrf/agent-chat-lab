"use client";

import { GlobeIcon, LinkIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { memo, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Favicon image with a globe fallback when the URL is missing or fails to load. */
export const SourceFavicon = memo(
  ({ favicon, className }: { favicon: string | null; className?: string }) => {
    const [failed, setFailed] = useState(false);
    if (!favicon || failed) {
      return (
        <GlobeIcon className={cn("size-4 shrink-0 text-muted-foreground", className)} />
      );
    }
    return (
      // Favicons come from arbitrary hosts; a plain img avoids next/image remote config.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={favicon}
        alt=""
        width={16}
        height={16}
        className={cn("size-4 shrink-0 rounded-sm object-contain", className)}
        onError={() => setFailed(true)}
      />
    );
  },
);

SourceFavicon.displayName = "SourceFavicon";

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = memo(({ className, ...props }: SourcesProps) => (
  <Collapsible className={cn("not-prose text-sm", className)} {...props} />
));

Sources.displayName = "Sources";

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = memo(
  ({ className, count, children, ...props }: SourcesTriggerProps) => (
    <CollapsibleTrigger
      className={cn(
        "group flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <LinkIcon className="size-3.5" />
          <span>来源 ({count})</span>
          <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </>
      )}
    </CollapsibleTrigger>
  ),
);

SourcesTrigger.displayName = "SourcesTrigger";

export const SourcesContent = memo(
  ({ className, ...props }: ComponentProps<typeof CollapsibleContent>) => (
    <CollapsibleContent
      className={cn(
        "mt-2 flex flex-col gap-1.5",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      {...props}
    />
  ),
);

SourcesContent.displayName = "SourcesContent";

export type SourceProps = Omit<ComponentProps<"a">, "title"> & {
  title?: ReactNode;
  favicon?: string | null;
};

export const Source = memo(
  ({ href, title, favicon, className, ...props }: SourceProps) => {
    const host = href ? hostOf(href) : "";
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-sidebar px-2.5 py-1.5 text-foreground transition-colors hover:border-primary/40",
          className,
        )}
        {...props}
      >
        <SourceFavicon favicon={favicon ?? null} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">{title || host}</span>
          {title ? (
            <span className="truncate text-[11px] text-muted-foreground">{host}</span>
          ) : null}
        </span>
      </a>
    );
  },
);

Source.displayName = "Source";
