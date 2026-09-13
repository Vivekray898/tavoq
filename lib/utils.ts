// /lib/utils.ts
export { cn } from "cn"; // ⚠️ verify this module name is correct

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
 * Format a date string to a human-readable format.
 * Handles date-only strings ("2026-09-24") as local dates.
 */
export function formatDate(dateStr: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const date = isDateOnly
    ? new Date(`${dateStr}T00:00:00`)
    : new Date(dateStr);

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format a date string to include time.
 */
export function formatDateTime(dateStr: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const date = isDateOnly
    ? new Date(`${dateStr}T00:00:00`)
    : new Date(dateStr);

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a date string to time only.
 */
export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Get relative time string. Handles both past and future dates.
 */
export function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
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
 * Check if a date is overdue.
 */
export function isOverdue(deadline: string | null): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return false;
  return d < new Date();
}

/**
 * Check if a date is due today.
 */
export function isDueToday(deadline: string | null): boolean {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  if (isNaN(deadlineDate.getTime())) return false;
  const today = new Date();
  return (
    deadlineDate.getFullYear() === today.getFullYear() &&
    deadlineDate.getMonth() === today.getMonth() &&
    deadlineDate.getDate() === today.getDate()
  );
}

/**
 * Check if a date is due within 24 hours (and not yet overdue).
 */
export function isDueSoon(deadline: string | null): boolean {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  if (isNaN(deadlineDate.getTime())) return false;
  const now = new Date();
  const diffMs = deadlineDate.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > 0 && diffHours <= 24;
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
 * Get greeting based on time of day.
 */
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}