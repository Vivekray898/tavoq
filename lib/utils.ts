// /lib/utils.ts
export { cn } from "cn";

import { CURRENCY_SYMBOL } from "./constants";

/**
 * Format a number as currency (INR).
 * Handles null/undefined/NaN gracefully.
 */
export function formatCurrency(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return `${CURRENCY_SYMBOL}0`;
  return `${CURRENCY_SYMBOL}${value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * All deadlines are stored as UTC instants and rendered in IST (§29).
 */
const IST_TZ = "Asia/Kolkata";

function istParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === "24" ? "00" : parts.hour,
    minute: parts.minute,
  };
}

/** Start of "today" in IST, expressed as a UTC instant. */
export function startOfTodayIST(): Date {
  const now = new Date();
  const p = istParts(now);
  // midnight IST = 18:30 UTC previous day (approx; compute exactly)
  const utcMidnightIST = new Date(
    `${p.year}-${p.month}-${p.day}T00:00:00+05:30`
  );
  return utcMidnightIST;
}

/**
 * Format a date string to a human-readable format (IST).
 * Handles date-only strings ("2026-09-24") as IST dates.
 */
export function formatDate(dateStr: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const date = isDateOnly ? new Date(`${dateStr}T00:00:00+05:30`) : new Date(dateStr);
  if (isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-IN", {
    timeZone: IST_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format a date string to include time (IST).
 */
export function formatDateTime(dateStr: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const date = isDateOnly ? new Date(`${dateStr}T00:00:00+05:30`) : new Date(dateStr);
  if (isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    timeZone: IST_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a date string to time only (IST).
 */
export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-IN", {
    timeZone: IST_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Natural deadline display (§29):
 *   "Due today · 6:00 PM"
 *   "Due tomorrow · 10:00 AM"
 *   "Due Fri, 18 Sep"
 *   "Overdue · 2 days"
 */
export function formatDeadline(
  deadline: string | null | undefined,
  opts?: { includeTime?: boolean }
): string {
  if (!deadline) return "No deadline";
  const date = new Date(deadline);
  if (isNaN(date.getTime())) return "No deadline";

  const now = new Date();
  const todayStart = startOfTodayIST();
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const diffMs = date.getTime() - now.getTime();
  const overdue = diffMs < 0;

  const isToday = date >= todayStart && date < tomorrowStart;
  const isTomorrow = date >= tomorrowStart && date < new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);

  const time = formatTime(deadline);
  const showTime = opts?.includeTime !== false && !isDateOnlyStr(deadline);

  if (isToday) {
    return overdue ? `Overdue · was due ${time}` : `Due today · ${time}`;
  }
  if (isTomorrow) {
    return `Due tomorrow · ${time}`;
  }

  if (overdue) {
    const days = Math.ceil((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (days <= 1) return `Overdue · was due ${time}`;
    return `Overdue · ${days} day${days !== 1 ? "s" : ""}`;
  }

  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  const label = date.toLocaleDateString("en-IN", {
    timeZone: IST_TZ,
    weekday: days <= 6 ? "short" : undefined,
    day: "numeric",
    month: "short",
  });
  return `Due ${label}${showTime ? ` · ${time}` : ""}`;
}

function isDateOnlyStr(s: string | null | undefined): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Whether the deadline is overdue (before now).
 */
export function isOverdue(deadline: string | null): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/**
 * Whether the deadline falls within today (IST).
 */
export function isDueToday(deadline: string | null): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return false;
  const todayStart = startOfTodayIST();
  return d >= todayStart && d < new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Due within 24 hours (and not yet overdue).
 */
export function isDueSoon(deadline: string | null): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return false;
  const diff = d.getTime() - Date.now();
  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

/**
 * Get initials from a name. Safe for null/empty input.
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const initials = name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return initials || "?";
}

/**
 * Truncate text with ellipsis.
 */
export function truncate(
  text: string | null | undefined,
  maxLength: number
): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

/**
 * Validate URL is http or https.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Detect a friendly resource type from a URL (§22).
 */
export function detectResourceType(
  url: string
): "DRIVE" | "CANVA" | "GOOGLE_DOC" | "GOOGLE_SHEET" | "WEBSITE" | "OTHER" {
  const u = url.toLowerCase();
  if (u.includes("drive.google.com") || u.includes("docs.google.com/drive")) return "DRIVE";
  if (u.includes("canva.com")) return "CANVA";
  if (u.includes("docs.google.com/document")) return "GOOGLE_DOC";
  if (u.includes("docs.google.com/spreadsheets")) return "GOOGLE_SHEET";
  if (u.startsWith("http")) return "WEBSITE";
  return "OTHER";
}

/**
 * Get greeting based on time of day (IST).
 */
export function getGreeting(): string {
  const p = istParts(new Date());
  const hour = parseInt(p.hour, 10);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Get relative time string. Handles both past and future dates.
 */
export function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = date.getTime() - now.getTime(); // future = positive
  const absSecs = Math.abs(Math.floor(diffMs / 1000));
  const absMins = Math.floor(absSecs / 60);
  const absHours = Math.floor(absMins / 60);
  const absDays = Math.floor(absHours / 24);

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absSecs < 60) return "Just now";
  if (absMins < 60) return rtf.format(Math.round(diffMs / 60000), "minute");
  if (absHours < 24) return rtf.format(Math.round(diffMs / 3600000), "hour");
  if (absDays < 7) return rtf.format(Math.round(diffMs / 86400000), "day");
  return formatDate(dateStr);
}

/**
 * Format a file size in bytes to a readable string.
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
