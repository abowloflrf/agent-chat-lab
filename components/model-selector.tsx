"use client";

import { useEffect, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const groups = buildEnabledModels(providers);
  const totalModels = groups.reduce((sum, g) => sum + g.models.length, 0);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (totalModels <= 1) {
    return null;
  }

  const displayLabel = selected?.modelId ?? "选择模型";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-2.5 py-1.5 text-[12px] text-[#4a4138] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="max-w-[180px] truncate font-mono text-[11px]">
          {displayLabel}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
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

      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[240px] max-w-[320px] overflow-hidden rounded-lg border border-[rgba(23,23,23,0.1)] bg-white shadow-lg shadow-black/8">
          <div className="max-h-[280px] overflow-y-auto py-1">
            {groups.map((group) => (
              <div key={group.providerId}>
                <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.18em] text-[#978b7e]">
                  {group.providerName}
                </div>
                {group.models.map((model) => {
                  const isSelected =
                    selected?.providerId === group.providerId &&
                    selected?.modelId === model.modelId;

                  return (
                    <button
                      key={`${group.providerId}-${model.id}`}
                      type="button"
                      onClick={() => {
                        onSelect({
                          providerId: group.providerId,
                          providerName: group.providerName,
                          modelId: model.modelId,
                        });
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-[rgba(201,106,43,0.06)] ${
                        isSelected
                          ? "font-medium text-[#9c5626]"
                          : "text-[#4a4138]"
                      }`}
                    >
                      <span
                        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                          isSelected ? "text-[#9c5626]" : "text-transparent"
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
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
