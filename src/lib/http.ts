import { NextResponse } from "next/server";

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

export function fail(error: string, status: number): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ success: false, data: null, error }, { status });
}

const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, number[]>();

/** Small in-memory sliding-window limiter; enough for a single-instance demo deployment. */
export function rateLimited(key: string, limit: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  hits.set(key, [...recent, now]);
  return false;
}

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}
