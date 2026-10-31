import { createHash } from "node:crypto";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short one-way fingerprint so deployed config can be compared with a local .env without exposing it. */
function fingerprint(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return {
    length: value.length,
    trimmedLength: trimmed.length,
    sha256: createHash("sha256").update(trimmed).digest("hex").slice(0, 8),
  };
}

export async function GET() {
  return ok({
    paypalEnv: process.env.PAYPAL_ENV ?? null,
    paypalClientId: fingerprint(process.env.PAYPAL_CLIENT_ID),
    paypalClientSecret: fingerprint(process.env.PAYPAL_CLIENT_SECRET),
    aiProvider: process.env.AI_PROVIDER ?? null,
  });
}
