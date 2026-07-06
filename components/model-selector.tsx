"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import type { ProviderSettings } from "@/lib/provider-config";

export type ModelSelection = {
  providerId: string;
  providerName: string;
  modelId: string;
};

type ModelSelectorProps = {
  providers: ProviderSettings[];
  selected: ModelSelection | null;
  onSelect: (selection: ModelSelection) => void;
  disabled?: boolean;
};

function buildEnabledModels(providers: ProviderSettings[]) {
  return providers
    .filter((p) => p.isEnabled && p.models.some((m) => m.isEnabled))
    .map((p) => ({
      providerId: p.id,
      providerName: p.name,
      models: p.models.filter((m) => m.isEnabled),
    }));
}

export function ModelSelector({
  providers,
  selected,
  onSelect,
  disabled = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = buildEnabledModels(providers);
  const totalModels = groups.reduce((sum, g) => sum + g.models.length, 0);

  if (totalModels <= 1) {
    return null;
  }

  const displayLabel = selected?.modelId ?? "选择模型";

  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = normalizedQuery
    ? groups
        .map((group) => ({
          ...group,
          models: group.providerName.toLowerCase().includes(normalizedQuery)
            ? group.models
            : group.models.filter((m) =>
                m.modelId.toLowerCase().includes(normalizedQuery),
              ),
        }))
        .filter((group) => group.models.length > 0)
    : groups;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
    }
  };

  const selectFirstMatch = () => {
    const group = filteredGroups[0];
    const model = group?.models[0];
    if (!group || !model) return;
    onSelect({
      providerId: group.providerId,
      providerName: group.providerName,
      modelId: model.modelId,
    });
    handleOpenChange(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="group inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[var(--muted-foreground)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="max-w-[88px] truncate font-mono text-[11px] sm:max-w-[180px]">
            {displayLabel}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="menu-appear z-50 w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-lg shadow-black/8 sm:w-auto sm:min-w-[240px] sm:max-w-[320px]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
              />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  selectFirstMatch();
                }
              }}
              placeholder="搜索模型…"
              aria-label="搜索模型"
              className="w-full min-w-0 bg-transparent font-mono text-[12px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-1 sm:max-h-[280px]">
            {filteredGroups.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12px] text-[var(--muted-foreground)]">
                无匹配模型
              </div>
            ) : null}
            {filteredGroups.map((group) => (
              <div key={group.providerId}>
                <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  {group.providerName}
                </div>
                {group.models.map((model) => {
                  const isSelected =
                    selected?.providerId === group.providerId &&
                    selected?.modelId === model.modelId;

                  return (
                    <Popover.Close asChild key={`${group.providerId}-${model.id}`}>
                      <button
                        type="button"
                        onClick={() =>
                          onSelect({
                            providerId: group.providerId,
                            providerName: group.providerName,
                            modelId: model.modelId,
                          })
                        }
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-[var(--surface-muted)] ${
                          isSelected
                            ? "font-medium text-[var(--accent)]"
                            : "text-[var(--foreground)]"
                        }`}
                      >
                        <span
                          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                            isSelected ? "text-[var(--accent)]" : "text-transparent"
                          }`}
                        >
                          {isSelected ? (
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 16 16"
                              fill="none"
                              className="h-3.5 w-3.5"
                            >
                              <path
                                d="M3 8.5l3.5 3.5 6.5-7"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </span>
                        <span className="truncate font-mono text-[12px]">
                          {model.modelId}
                        </span>
                      </button>
                    </Popover.Close>
                  );
                })}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
