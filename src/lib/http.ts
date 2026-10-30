import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSessionUser, type SessionUser } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new ApiError(404, what);

type Ctx<P> = { params: Promise<P> };

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function checkOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new ApiError(403, "Cross-site request blocked");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, "Invalid origin");
  }
}

function toResponse(e: unknown) {
  if (e instanceof ApiError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const field = first?.path.join(".");
    return NextResponse.json(
      { error: field ? `${field}: ${first.message}` : (first?.message ?? "Invalid input"), issues: e.issues },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** Wrap an authenticated route handler with session lookup, origin checks and error mapping. */
export function authed<P = Record<string, never>>(
  handler: (req: NextRequest, user: SessionUser, params: P) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      const user = await getSessionUser();
      if (!user) throw new ApiError(401, "Please sign in");
      return await handler(req, user, await ctx.params);
    } catch (e) {
      return toResponse(e);
    }
  };
}

export function publicRoute<P = Record<string, never>>(handler: (req: NextRequest, params: P) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      return await handler(req, await ctx.params);
    } catch (e) {
      return toResponse(e);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new ApiError(415, "Expected application/json");
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, "Malformed JSON");
  }
  return schema.parse(json);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);
