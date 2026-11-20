import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Clamp helper used by a few UI bits. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** JSON pretty-print with fallback for non-serialisable values. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Try to parse JSON, returning undefined on failure (never throws). */
export function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
