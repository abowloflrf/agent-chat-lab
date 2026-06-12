const DISPLAY_LOCALE = "zh-CN";
const DISPLAY_TIME_ZONE = "Asia/Shanghai";

export function formatMessageDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function formatClockTime(timestamp: number) {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export function formatFullDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

// YYYYMMDD integer in Asia/Shanghai, for grouping usage_records by day.
export function toDayKey(timestamp: number): number {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
  return Number(formatted.replaceAll("-", ""));
}

// Turn a YYYYMMDD integer back into a short "MM-DD" label for chart axes.
export function formatDayKeyShort(dayKey: number): string {
  const text = String(dayKey);
  if (text.length !== 8) {
    return text;
  }
  return `${text.slice(4, 6)}-${text.slice(6, 8)}`;
}
