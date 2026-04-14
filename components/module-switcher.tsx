"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const modules = [
  {
    label: "Chat",
    href: "/",
  },
  {
    label: "系统设置",
    href: "/settings",
  },
  {
    label: "TODO",
    href: "/todos",
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
  const activeModule = modules.find((item) => isActive(pathname, item.href)) ?? modules[0];

  return (
    <div className="relative space-y-3">
      <Link
        href="/"
        className="group block transition hover:text-[#ffd8bd]"
        aria-label="返回 Chat 首页"
      >
        <span className="block text-[11px] uppercase tracking-[0.28em] text-[#c4b6a4] transition group-hover:text-[#ead7c5]">
          Agent Chat Lab
        </span>
        <span className="mt-2 block text-[28px] font-semibold leading-[0.95] tracking-[-0.04em] text-[#fff7ef] transition group-hover:text-[#ffd8bd]">
          Agent
          <br />
          Chat Lab
        </span>
      </Link>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="group inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left transition hover:border-[#d98a52]/70 hover:bg-white/[0.08]"
          aria-expanded={open}
        >
          <span className="truncate text-sm font-medium text-[#fff7ef]">
            {activeModule.label}
          </span>
          <span className={`text-xs text-[#d8c9b7] transition ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>

        {open ? (
          <div className="absolute left-0 top-[calc(100%+0.4rem)] z-20 min-w-36 overflow-hidden rounded-xl border border-white/10 bg-[#221d16]/95 p-1 shadow-2xl shadow-black/30 backdrop-blur">
            {modules.map((item) => {
              const active = item.label === activeModule.label;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-white/10 text-[#fff7ef]"
                      : "text-[#d8c9b7] hover:bg-white/[0.07] hover:text-[#fff7ef]"
                  }`}
                >
                  <span className="font-medium">{item.label}</span>
                  {active ? <span className="text-xs text-[#d98a52]">●</span> : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
