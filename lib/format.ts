// Shared number/token formatters used by the chat shell and the stats dashboards.

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatContextLength(tokenCount: number | null): string {
  if (tokenCount === null) {
    return "--";
  }

  return new Intl.NumberFormat("zh-CN").format(tokenCount);
}

export function formatCacheHitRate(rate: number | null): string {
  if (rate === null) {
    return "--";
  }

  return (rate * 100).toFixed(1);
}

export function formatCompactTokens(tokenCount: number | null): string {
  if (tokenCount === null) {
    return "--";
  }

  if (tokenCount < 1000) {
    return String(tokenCount);
  }

  if (tokenCount < 1_000_000) {
    const thousands = tokenCount / 1000;
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }

  return `${(tokenCount / 1_000_000).toFixed(1)}M`;
}

export function formatDataSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const totalSeconds = Math.round(durationMs / 1000);

  if (totalSeconds < 60) {
    const seconds = durationMs / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (totalMinutes < 60) {
    return `${totalMinutes} min ${seconds} s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${minutes} min`;
}
