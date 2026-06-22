"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const modules = [
  {
    label: "Chat",
    href: "/",
  },
  {
    label: "Todo",
    href: "/todos",
  },
  {
    label: "Setting",
    href: "/settings",
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
}

export function ModuleSwitcher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const activeModule = modules.find((item) => isActive(pathname, item.href)) ?? modules[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative space-y-2.5">
      <Link
        href="/"
        className="group block transition hover:text-[var(--panel-foreground)]"
        aria-label="返回 Chat 首页"
      >
        <span className="block text-[11px] uppercase tracking-[0.28em] text-[var(--panel-muted)] transition group-hover:text-[var(--panel-foreground)]">
          Agent Chat Lab
        </span>
        <span className="mt-2 block text-[28px] font-semibold leading-[0.95] tracking-[-0.04em] text-[var(--panel-foreground)] transition group-hover:text-[var(--panel-foreground)]">
          Agent
          <br />
          Chat Lab
        </span>
      </Link>

      <div ref={switcherRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-left transition hover:border-[var(--accent)]/70 hover:bg-white/[0.08]"
          aria-expanded={open}
        >
          <span className="truncate text-[13px] font-medium text-[var(--panel-foreground)]">
            {activeModule.label}
          </span>
          <span className={`text-xs text-[var(--panel-muted)] transition ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>

        {open ? (
          <div className="absolute left-0 top-[calc(100%+0.35rem)] z-20 min-w-36 rounded-xl border border-white/10 bg-[var(--panel-soft)] p-1.5 shadow-2xl shadow-black/30 backdrop-blur">
            {modules.map((item) => {
              const active = item.label === activeModule.label;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`mb-1 last:mb-0 flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-[13px] transition ${
                    active
                      ? "bg-white/10 text-[var(--panel-foreground)]"
                      : "text-[var(--panel-muted)] hover:bg-white/[0.07] hover:text-[var(--panel-foreground)]"
                  }`}
                >
                  <span className="font-medium">{item.label}</span>
                  {active ? <span className="text-xs text-[var(--accent)]">●</span> : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
