"use client";

import { memo } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { SourceFavicon, hostOf } from "@/components/ai-elements/source";
import type { CitationSource } from "@/lib/ai/message-sources";

export type InlineCitationBadgeProps = {
  source: CitationSource;
};

/**
 * A superscript citation badge ([n]) that opens a hover card with the source's
 * favicon, title, domain and snippet. Single source per badge (no carousel).
 */
export const InlineCitationBadge = memo(
  ({ source }: InlineCitationBadgeProps) => {
    const host = hostOf(source.url);
    return (
      <HoverCard openDelay={120} closeDelay={120}>
        <HoverCardTrigger asChild>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`来源：${host}`}
            className="group/cite mx-px inline-flex size-3 items-center justify-center align-super no-underline"
          >
            <span className="size-[5px] rounded-full bg-primary/60 transition-all group-hover/cite:scale-125 group-hover/cite:bg-primary" />
          </a>
        </HoverCardTrigger>
        <HoverCardContent>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-1.5"
          >
            <span className="flex items-center gap-1.5">
              <SourceFavicon favicon={source.favicon} />
              <span className="truncate text-[11px] text-muted-foreground">
                {host}
              </span>
            </span>
            {source.title ? (
              <span className="line-clamp-2 text-sm font-medium text-foreground">
                {source.title}
              </span>
            ) : null}
            {source.snippet ? (
              <span className="line-clamp-3 text-xs text-muted-foreground">
                {source.snippet}
              </span>
            ) : null}
          </a>
        </HoverCardContent>
      </HoverCard>
    );
  },
);

InlineCitationBadge.displayName = "InlineCitationBadge";
