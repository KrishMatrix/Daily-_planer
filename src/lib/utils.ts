import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export class FetchError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** JSON fetch helper for the client. Throws FetchError with the server's message. */
export async function api<T = unknown>(url: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body !== undefined ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new FetchError(0, "You're offline — changes need a connection.");
  }
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) window.location.href = "/login";
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    throw new FetchError(res.status, offline ? "You're offline — changes need a connection." : String(data.error ?? `Request failed (${res.status})`), data);
  }
  return data as T;
}

export function formatMinutes(mins: number) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatUsd(v: number) {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
