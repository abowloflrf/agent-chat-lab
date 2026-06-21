"use client";

import * as Popover from "@radix-ui/react-popover";
import { memo } from "react";
import { SourceFavicon, hostOf } from "@/components/ai-elements/source";
import type { CitationSource } from "@/lib/ai/message-sources";

export type InlineCitationBadgeProps = {
  source: CitationSource;
};

// Glass card, moved over from the removed hover-card.tsx.
const CARD_CLASS =
  "z-50 w-72 rounded-xl border border-[rgba(23,23,23,0.08)] bg-[var(--glass-bg)] p-3 text-foreground outline-none backdrop-blur-xl backdrop-saturate-[1.8] backdrop-brightness-105 shadow-[0_18px_40px_rgba(74,51,40,0.16),inset_0_1px_0_rgba(255,255,255,0.8),inset_0_0_0_1px_rgba(255,255,255,0.12)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

/**
 * Inline citation chip: favicon + domain. Tapping opens a popover card with the
 * source's title, domain, snippet and link. Click-driven so it works on touch.
 */
export const InlineCitationBadge = memo(({ source }: InlineCitationBadgeProps) => {
  const host = hostOf(source.url);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`来源：${host}`}
          className="mx-0.5 inline-flex max-w-[11rem] cursor-pointer items-center gap-1 rounded-full border border-border bg-sidebar px-1.5 py-0.5 align-middle text-[11px] leading-normal text-muted-foreground no-underline transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <SourceFavicon favicon={source.favicon} url={source.url} className="size-3" />
          <span className="max-w-[8rem] truncate">{host}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={CARD_CLASS}>
          <a href={source.url} target="_blank" rel="noreferrer" className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <SourceFavicon favicon={source.favicon} url={source.url} />
              <span className="truncate text-[11px] text-muted-foreground">{host}</span>
            </span>
            {source.title ? (
              <span className="line-clamp-2 text-sm font-medium text-foreground">{source.title}</span>
            ) : null}
            {source.snippet ? (
              <span className="line-clamp-3 text-xs text-muted-foreground">{source.snippet}</span>
            ) : null}
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});

InlineCitationBadge.displayName = "InlineCitationBadge";
