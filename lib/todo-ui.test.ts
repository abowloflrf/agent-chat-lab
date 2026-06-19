import { afterEach, describe, it, expect, vi } from "vitest";
import {
  emptyDraft,
  formatRelativeTime,
  formatTime,
  nextPriority,
  nextStatus,
  priorityMark,
  toDraft,
} from "@/lib/todo-ui";
import type { TodoRecord } from "@/lib/persistence";

describe("priorityMark", () => {
  it.each([
    ["highest", "!!"],
    ["high", "!"],
    ["default", ""],
  ] as const)("maps %s -> %s", (priority, expected) => {
    expect(priorityMark(priority)).toBe(expected);
  });
});

describe("nextStatus", () => {
  it("cycles todo -> in_progress -> done -> todo", () => {
    expect(nextStatus("todo")).toBe("in_progress");
    expect(nextStatus("in_progress")).toBe("done");
    expect(nextStatus("done")).toBe("todo");
  });

  it("returns to the start after a full cycle", () => {
    const start = "todo" as const;
    expect(nextStatus(nextStatus(nextStatus(start)))).toBe(start);
  });
});

describe("nextPriority", () => {
  it("cycles default -> high -> highest -> default", () => {
    expect(nextPriority("default")).toBe("high");
    expect(nextPriority("high")).toBe("highest");
    expect(nextPriority("highest")).toBe("default");
  });

  it("returns to the start after a full cycle", () => {
    const start = "default" as const;
    expect(nextPriority(nextPriority(nextPriority(start)))).toBe(start);
  });
});

describe("toDraft", () => {
  const todo: TodoRecord = {
    id: "todo-1",
    title: "Write tests",
    content: "Write unit tests for todo-ui",
    status: "in_progress",
    priority: "high",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    completedAt: null,
  };

  it("maps the editable fields onto a draft", () => {
    expect(toDraft(todo)).toEqual({
      id: "todo-1",
      title: "Write tests",
      content: "Write unit tests for todo-ui",
      status: "in_progress",
      priority: "high",
    });
  });

  it("does not copy timestamp/metadata fields", () => {
    const draft = toDraft(todo);
    expect(Object.keys(draft).sort()).toEqual(
      ["content", "id", "priority", "status", "title"].sort(),
    );
    expect("createdAt" in draft).toBe(false);
    expect("updatedAt" in draft).toBe(false);
    expect("completedAt" in draft).toBe(false);
  });

  it("preserves the original id (non-null) rather than emptyDraft's null", () => {
    expect(toDraft(todo).id).toBe("todo-1");
    expect(emptyDraft.id).toBeNull();
  });
});

describe("formatTime", () => {
  it("returns the unfinished placeholder for null", () => {
    expect(formatTime(null)).toBe("未完成");
  });

  it("formats a valid ISO string as MM<sep>DD HH:mm", () => {
    const out = formatTime("2026-03-05T08:09:00Z");
    // zh-CN 2-digit month/day/hour/minute; separator is locale-dependent
    // ("/" on this runner). Pin the structure with a regex.
    expect(out).toMatch(/^\d{2}[\/-]\d{2}\s\d{2}:\d{2}$/);
  });

  it("renders Asia/Shanghai (UTC+8) local time for the given instant", () => {
    // 08:09 UTC -> 16:09 in Asia/Shanghai, which the runner's TZ pins.
    const out = formatTime("2026-03-05T08:09:00Z");
    expect(out).toContain("16:09");
    expect(out).toContain("03");
    expect(out).toContain("05");
  });

  it("matches the exact zh-CN/Asia-Shanghai rendering", () => {
    // Exact value locks month/day/hour/minute ordering + separator together,
    // catching regressions a loose regex would miss. 08:09 UTC -> 16:09 +08.
    expect(formatTime("2026-03-05T08:09:00Z")).toBe("03/05 16:09");
  });

  it("pads single-digit components to two digits", () => {
    // 2026-01-02 00:05 UTC -> 08:05 on 01-02 in Asia/Shanghai.
    expect(formatTime("2026-01-02T00:05:00Z")).toBe("01/02 08:05");
  });

  it("crosses the date boundary when UTC+8 pushes into the next day", () => {
    // 2026-03-05 20:00 UTC -> 04:00 on 03-06 in Asia/Shanghai (+8h).
    expect(formatTime("2026-03-05T20:00:00Z")).toBe("03/06 04:00");
  });
});

describe("formatRelativeTime", () => {
  // Fixed "now" so Date.now() is deterministic across runs/machines.
  const NOW = new Date("2026-06-19T12:00:00.000Z").getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  function freeze() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  function isoAgo(ms: number) {
    return new Date(NOW - ms).toISOString();
  }

  it("returns '' for an unparseable date string", () => {
    freeze();
    expect(formatRelativeTime("not-a-date")).toBe("");
  });

  it("returns the just-now label for less than one minute ago (boundary at 0ms)", () => {
    freeze();
    expect(formatRelativeTime(isoAgo(0))).toBe("刚刚");
  });

  it("returns the just-now label just under one minute (59s)", () => {
    freeze();
    expect(formatRelativeTime(isoAgo(59_000))).toBe("刚刚");
  });

  it("formats minutes from exactly one minute up to under an hour", () => {
    freeze();
    expect(formatRelativeTime(isoAgo(60_000))).toBe("1 分钟前");
    expect(formatRelativeTime(isoAgo(5 * 60_000))).toBe("5 分钟前");
    expect(formatRelativeTime(isoAgo(59 * 60_000))).toBe("59 分钟前");
  });

  it("floors leftover seconds within the minutes branch (1m59s -> 1 minute)", () => {
    freeze();
    expect(formatRelativeTime(isoAgo(60_000 + 59_000))).toBe("1 分钟前");
  });

  it("floors minutes into hours (59m59s after the hour is still hours)", () => {
    freeze();
    // 1h 59m 59s -> floor to 1 hour, never "119 minutes".
    expect(formatRelativeTime(isoAgo(60 * 60_000 + 59 * 60_000 + 59_000))).toBe(
      "1 小时前",
    );
  });

  it("formats hours from exactly one hour up to under a day", () => {
    freeze();
    expect(formatRelativeTime(isoAgo(60 * 60_000))).toBe("1 小时前");
    expect(formatRelativeTime(isoAgo(23 * 60 * 60_000))).toBe("23 小时前");
  });

  it("stays in hours just under the 24h boundary (23h59m)", () => {
    freeze();
    expect(formatRelativeTime(isoAgo(23 * 60 * 60_000 + 59 * 60_000))).toBe(
      "23 小时前",
    );
  });

  it("formats days from exactly one day up to under seven days", () => {
    freeze();
    const day = 24 * 60 * 60_000;
    expect(formatRelativeTime(isoAgo(day))).toBe("1 天前");
    expect(formatRelativeTime(isoAgo(6 * day))).toBe("6 天前");
  });

  it("stays at 6 days just under the 7-day boundary (6d23h59m)", () => {
    freeze();
    const day = 24 * 60 * 60_000;
    expect(
      formatRelativeTime(isoAgo(6 * day + 23 * 60 * 60_000 + 59 * 60_000)),
    ).toBe("6 天前");
  });

  it("returns a formatted date string at exactly seven days", () => {
    freeze();
    const day = 24 * 60 * 60_000;
    const out = formatRelativeTime(isoAgo(7 * day));
    // Falls through to the MM<sep>DD date formatter, not "N days ago".
    expect(out).not.toMatch(/天前$/);
    expect(out).toMatch(/^\d{2}[\/-]\d{2}$/);
    // NOW - 7d = 2026-06-12T12:00:00Z -> 06-12 (20:00 +08, same calendar day).
    expect(out).toBe("06/12");
  });

  it("returns a formatted date string well beyond seven days", () => {
    freeze();
    const day = 24 * 60 * 60_000;
    // NOW - 30d = 2026-05-20T12:00:00Z -> 05-20 in Asia/Shanghai.
    expect(formatRelativeTime(isoAgo(30 * day))).toBe("05/20");
  });

  it("treats a future timestamp (negative elapsed) as just now", () => {
    freeze();
    // elapsedMs < 0 -> minutes < 1 -> just-now label.
    expect(formatRelativeTime(isoAgo(-5_000))).toBe("刚刚");
  });
});
