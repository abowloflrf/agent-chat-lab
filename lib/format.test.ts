import { describe, it, expect } from "vitest";
import {
  formatTokenCount,
  formatContextLength,
  formatCacheHitRate,
  formatCompactTokens,
  formatDataSize,
  formatDurationMs,
} from "@/lib/format";

describe("formatTokenCount", () => {
  it("groups thousands with the zh-CN separator", () => {
    expect(formatTokenCount(1234567)).toBe("1,234,567");
  });

  it.each<[number, string]>([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [12345, "12,345"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatTokenCount(input)).toBe(expected);
  });

  it("groups negative numbers with a leading minus", () => {
    expect(formatTokenCount(-1234567)).toBe("-1,234,567");
  });
});

describe("formatContextLength", () => {
  it("returns -- for null", () => {
    expect(formatContextLength(null)).toBe("--");
  });

  it("groups thousands like formatTokenCount", () => {
    expect(formatContextLength(1234567)).toBe("1,234,567");
  });

  it("formats zero as 0 (not the null sentinel)", () => {
    expect(formatContextLength(0)).toBe("0");
  });
});

describe("formatCacheHitRate", () => {
  it("returns -- for null", () => {
    expect(formatCacheHitRate(null)).toBe("--");
  });

  it("converts a fraction to a one-decimal percentage", () => {
    expect(formatCacheHitRate(0.1234)).toBe("12.3");
  });

  it.each<[number, string]>([
    [0, "0.0"],
    [1, "100.0"],
    [0.5, "50.0"],
  ])("formats rate %f as %s", (input, expected) => {
    expect(formatCacheHitRate(input)).toBe(expected);
  });

  it("rounds to a single decimal via toFixed", () => {
    expect(formatCacheHitRate(0.12345)).toBe("12.3");
    expect(formatCacheHitRate(0.005)).toBe("0.5");
  });

  it("does not clamp rates above 1 (returns >100)", () => {
    expect(formatCacheHitRate(1.5)).toBe("150.0");
  });

  it("does not clamp negative rates (returns a signed percentage)", () => {
    expect(formatCacheHitRate(-0.1)).toBe("-10.0");
  });
});

describe("formatCompactTokens", () => {
  it("returns -- for null", () => {
    expect(formatCompactTokens(null)).toBe("--");
  });

  it.each<[number, string]>([
    [0, "0"],
    [1, "1"],
    [999, "999"],
  ])("returns the plain string for values below 1000 (%d)", (input, expected) => {
    expect(formatCompactTokens(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [1000, "1.0k"],
    [1500, "1.5k"],
    [99999, "100.0k"], // 99.999 < 100 → toFixed(1) rounds to "100.0k"
  ])("formats thousands below 100k with one decimal (%d)", (input, expected) => {
    expect(formatCompactTokens(input)).toBe(expected);
  });

  it("renders one decimal of precision for mid-range thousands", () => {
    expect(formatCompactTokens(1234)).toBe("1.2k");
    expect(formatCompactTokens(12345)).toBe("12.3k");
  });

  it.each<[number, string]>([
    [100000, "100k"], // exactly 100 → rounds, no decimal
    [150000, "150k"],
    [100499, "100k"], // 100.499 → Math.round → 100
    [100500, "101k"], // 100.5 → Math.round half-up → 101
    [999999, "1000k"], // 999.999 rounds up to 1000k while still < 1,000,000
  ])("rounds thousands at or above 100k with no decimal (%d)", (input, expected) => {
    expect(formatCompactTokens(input)).toBe(expected);
  });

  it("treats negatives as below the 1000 threshold (plain string)", () => {
    // KNOWN GAP: there is no lower bound, so negatives bypass compaction and
    // are returned verbatim via String(). Pins current behavior.
    expect(formatCompactTokens(-5)).toBe("-5");
    expect(formatCompactTokens(-1500)).toBe("-1500");
  });

  it.each<[number, string]>([
    [1_000_000, "1.0M"],
    [1_500_000, "1.5M"],
    [2_340_000, "2.3M"],
  ])("formats millions with one decimal (%d)", (input, expected) => {
    expect(formatCompactTokens(input)).toBe(expected);
  });
});

describe("formatDataSize", () => {
  it.each<[number, string]>([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
  ])("formats raw bytes below 1024 (%d)", (input, expected) => {
    expect(formatDataSize(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [1024, "1.0 KB"],
    [1536, "1.5 KB"], // 1.5 * 1024
    [1024 * 1024 - 1, "1024.0 KB"],
  ])("formats kilobytes with one decimal (%d)", (input, expected) => {
    expect(formatDataSize(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 3, "3.0 MB"],
    [1024 * 1024 * 1024 - 1, "1024.0 MB"],
  ])("formats megabytes with one decimal (%d)", (input, expected) => {
    expect(formatDataSize(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [1024 * 1024 * 1024, "1.0 GB"],
    [1024 * 1024 * 1024 * 2, "2.0 GB"],
  ])("formats gigabytes with one decimal (%d)", (input, expected) => {
    expect(formatDataSize(input)).toBe(expected);
  });

  it("keeps using GB beyond a terabyte (no TB unit)", () => {
    // KNOWN GAP: GB is the largest unit, so a 1 TiB value renders as
    // "1024.0 GB" and arbitrarily large inputs keep scaling GB.
    expect(formatDataSize(1024 * 1024 * 1024 * 1024)).toBe("1024.0 GB");
    expect(formatDataSize(5 * 1024 * 1024 * 1024 * 1024)).toBe("5120.0 GB");
  });
});

describe("formatDurationMs", () => {
  it.each<[number, string]>([
    [0, "0 ms"],
    [1, "1 ms"],
    [999, "999 ms"],
  ])("formats sub-second durations in ms (%d)", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [1000, "1.0 s"],
    [5500, "5.5 s"],
    [9999, "10.0 s"], // 9.999 < 10 → toFixed(1) → "10.0 s"
  ])("formats seconds below 10 with one decimal (%d)", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [10000, "10 s"],
    [15000, "15 s"],
    [59400, "59 s"], // totalSeconds=59 < 60 → seconds=59.4 → toFixed(0) → "59 s"
  ])("formats seconds at or above 10 with no decimal (%d)", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });

  it("formats a low-single-digit second with one decimal", () => {
    expect(formatDurationMs(1500)).toBe("1.5 s");
  });

  it("rolls over to minutes once rounded seconds reach 60", () => {
    // 59500ms → Math.round(59.5) = 60 → not < 60 → minutes branch.
    expect(formatDurationMs(59500)).toBe("1 min 0 s");
  });

  it("carries the rounded remainder seconds into the minutes branch", () => {
    // 60500ms → Math.round(60.5) = 61 → 1 min 1 s (uses rounded totalSeconds,
    // not the raw ms remainder).
    expect(formatDurationMs(60500)).toBe("1 min 1 s");
  });

  it.each<[number, string]>([
    [60000, "1 min 0 s"],
    [90000, "1 min 30 s"],
    [125000, "2 min 5 s"],
    [3599000, "59 min 59 s"],
  ])("formats minutes-and-seconds below an hour (%d)", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [3600000, "1 h 0 min"],
    [3661000, "1 h 1 min"],
    [7320000, "2 h 2 min"],
    [3659999, "1 h 1 min"], // round(3659.999)=3660s → 61 min → 1 h 1 min
    [86400000, "24 h 0 min"], // a full day; hours are not capped
  ])("formats hours-and-minutes at or above an hour (%d)", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });

  it("drops sub-minute seconds in the hours branch (only h and min shown)", () => {
    // 3630000ms = 1 h 0 min 30 s, but the hours branch reports only h and min.
    expect(formatDurationMs(3630000)).toBe("1 h 0 min");
  });
});
