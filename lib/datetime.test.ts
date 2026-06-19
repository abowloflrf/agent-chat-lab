import { describe, it, expect } from "vitest";
import {
  formatMessageDateTime,
  formatClockTime,
  formatFullDateTime,
  toDayKey,
  formatDayKeyShort,
} from "@/lib/datetime";

// All functions in this module pin timeZone Asia/Shanghai (+08, no DST) and
// locale zh-CN, so the produced strings are deterministic regardless of the
// machine's timezone/locale. The zh-CN locale renders date parts with "/"
// separators (e.g. "06/19", "2026/06/19"), which is what these tests assert.

// A UTC instant that lands on a DIFFERENT calendar day in Shanghai:
// 2026-06-18T20:00:00Z === 2026-06-19T04:00:00 +08.
const CROSS_DAY = Date.UTC(2026, 5, 18, 20, 0, 0);
// A plain daytime instant: 2026-01-05T03:07:09Z === 2026-01-05T11:07:09 +08.
const DAYTIME = Date.UTC(2026, 0, 5, 3, 7, 9);

describe("formatMessageDateTime", () => {
  it("formats month/day hour:minute (24h) in Shanghai time", () => {
    expect(formatMessageDateTime(DAYTIME)).toBe("01/05 11:07");
  });

  it("reflects the +08 timezone shift across a day boundary", () => {
    // The UTC instant is on the 18th, but in Shanghai it is the 19th at 04:00.
    expect(formatMessageDateTime(CROSS_DAY)).toBe("06/19 04:00");
  });

  it("produces a value matching the MM/DD HH:MM shape", () => {
    expect(formatMessageDateTime(DAYTIME)).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it("does not include seconds", () => {
    expect(formatMessageDateTime(DAYTIME)).not.toMatch(/:\d{2}:\d{2}/);
  });
});

describe("formatClockTime", () => {
  it("formats hour:minute:second (24h) in Shanghai time", () => {
    expect(formatClockTime(DAYTIME)).toBe("11:07:09");
  });

  it("reflects the +08 timezone shift (04:00:00, not 20:00:00)", () => {
    expect(formatClockTime(CROSS_DAY)).toBe("04:00:00");
  });

  it("renders 24-hour midnight as 00:00:00 (hour12 false)", () => {
    // 2026-06-18T16:00:00Z === 2026-06-19T00:00:00 +08.
    expect(formatClockTime(Date.UTC(2026, 5, 18, 16, 0, 0))).toBe("00:00:00");
  });

  it("renders noon as 12:00:00 under hour12 false", () => {
    // 2026-06-19T04:00:00Z === 2026-06-19T12:00:00 +08; the hour12:false
    // branch must keep this as 12 (not 0), distinct from the midnight case.
    expect(formatClockTime(Date.UTC(2026, 5, 19, 4, 0, 0))).toBe("12:00:00");
  });

  it("renders a late-evening time without rolling the hour over 23", () => {
    // 2026-06-19T15:30:45Z === 2026-06-19T23:30:45 +08.
    expect(formatClockTime(Date.UTC(2026, 5, 19, 15, 30, 45))).toBe("23:30:45");
  });

  it("produces a value matching the HH:MM:SS shape", () => {
    expect(formatClockTime(DAYTIME)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("formatFullDateTime", () => {
  it("formats year/month/day hour:minute (24h) in Shanghai time", () => {
    expect(formatFullDateTime(DAYTIME)).toBe("2026/01/05 11:07");
  });

  it("reflects the +08 timezone shift across a day boundary", () => {
    expect(formatFullDateTime(CROSS_DAY)).toBe("2026/06/19 04:00");
  });

  it("rolls the year forward across the New Year boundary in Shanghai", () => {
    // 2025-12-31T16:00:00Z === 2026-01-01T00:00:00 +08, so the year, month,
    // and day all advance even though the UTC instant is still in 2025.
    expect(formatFullDateTime(Date.UTC(2025, 11, 31, 16, 0, 0))).toBe(
      "2026/01/01 00:00",
    );
  });

  it("formats a pre-epoch (negative) timestamp in Shanghai time", () => {
    // -1 ms === 1969-12-31T23:59:59.999Z === 1970-01-01T07:59:59.999 +08.
    expect(formatFullDateTime(-1)).toBe("1970/01/01 07:59");
  });

  it("produces a value matching the YYYY/MM/DD HH:MM shape", () => {
    expect(formatFullDateTime(DAYTIME)).toMatch(
      /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/,
    );
  });
});

describe("toDayKey", () => {
  it("returns a YYYYMMDD integer for a plain daytime instant", () => {
    expect(toDayKey(DAYTIME)).toBe(20260105);
  });

  it("uses Shanghai-local calendar day across the UTC boundary", () => {
    // The UTC day is the 18th; Shanghai day is the 19th -> 20260619.
    expect(toDayKey(CROSS_DAY)).toBe(20260619);
  });

  it("returns a number, not a string", () => {
    expect(typeof toDayKey(DAYTIME)).toBe("number");
  });

  it("zero-pads single-digit months and days", () => {
    // 2026-01-05T00:00:00 +08 === 2026-01-04T16:00:00Z.
    expect(toDayKey(Date.UTC(2026, 0, 4, 16, 0, 0))).toBe(20260105);
  });

  it("maps the Unix epoch to its Shanghai day (1970-01-01 08:00 +08)", () => {
    expect(toDayKey(0)).toBe(19700101);
  });

  it("rolls the year forward across the New Year boundary in Shanghai", () => {
    // 2025-12-31T16:00:00Z === 2026-01-01T00:00:00 +08 -> 20260101.
    expect(toDayKey(Date.UTC(2025, 11, 31, 16, 0, 0))).toBe(20260101);
  });

  it("keeps a pre-epoch instant on its Shanghai calendar day", () => {
    // -1 ms === 1970-01-01T07:59:59.999 +08, still the 1st in Shanghai.
    expect(toDayKey(-1)).toBe(19700101);
  });
});

describe("formatDayKeyShort", () => {
  it("turns an 8-digit key into MM-DD", () => {
    expect(formatDayKeyShort(20260619)).toBe("06-19");
  });

  it("handles a key with a leading-zero-free month/day correctly", () => {
    expect(formatDayKeyShort(20260105)).toBe("01-05");
  });

  it("round-trips with toDayKey for the cross-day instant", () => {
    expect(formatDayKeyShort(toDayKey(CROSS_DAY))).toBe("06-19");
  });

  it.each([
    [2026061, "2026061"],
    [202606199, "202606199"],
    [0, "0"],
    [1, "1"],
    // A 9-char string (8 digits + sign) is also non-8-length -> unchanged.
    [-20260619, "-20260619"],
    // A negative whose String length is 7 -> unchanged.
    [-202606, "-202606"],
  ])(
    "returns String(input) unchanged for non-8-digit input %d",
    (input, expected) => {
      expect(formatDayKeyShort(input)).toBe(expected);
    },
  );

  it("slices any 8-char numeric string without validating it as a date", () => {
    // KNOWN GAP: the function only checks String length === 8 and never
    // validates that the digits form a real YYYYMMDD; an arbitrary 8-digit
    // number is blindly sliced into a "MM-DD"-shaped label. Pinning behavior.
    expect(formatDayKeyShort(12345678)).toBe("56-78");
  });

  it("treats a negative number's string length literally (sign counts)", () => {
    // String(-2026061) has length 8 ("-2026061"), so it slices the string
    // rather than returning it unchanged: slice(4,6)="60", slice(6,8)="61".
    // KNOWN GAP: formatDayKeyShort assumes well-formed positive YYYYMMDD keys
    // and does not validate the value; a negative input yields a nonsensical
    // label instead of being rejected. Pinning current behavior.
    expect(formatDayKeyShort(-2026061)).toBe("60-61");
  });
});
