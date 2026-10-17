import "server-only";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────
//  Supabase (service_role) — created lazily so `next build` works without env
// ─────────────────────────────────────────
let client: SupabaseClient | undefined;
export const db = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    client ??= createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const v = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? v.bind(client) : v;
  },
});

export const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status });

// ─────────────────────────────────────────
//  Telegram Mini App auth (initData HMAC)
//  https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// ─────────────────────────────────────────
const MAX_AGE_SEC = 24 * 60 * 60;

export type TgUser = { id: number; first_name?: string; username?: string };

export function validateInitData(initData: string): TgUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.BOT_TOKEN ?? "")
    .digest();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "");
    return typeof user?.id === "number" ? (user as TgUser) : null;
  } catch {
    return null;
  }
}

type Auth =
  | { user: TgUser; res?: undefined }
  | { user?: undefined; res: NextResponse };

/** Header format:  Authorization: tma <initData> */
export async function authenticate(req: NextRequest): Promise<Auth> {
  const header = req.headers.get("authorization") ?? "";
  const user = header.startsWith("tma ") ? validateInitData(header.slice(4)) : null;
  if (!user) {
    return { res: fail(401, "الجلسة غير صالحة، افتح الصفحة من البوت من جديد.") };
  }
  const { data } = await db
    .from("users")
    .select("is_banned")
    .eq("telegram_id", user.id)
    .maybeSingle();
  if (data?.is_banned) return { res: fail(403, "حسابك محظور.") };
  return { user };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the channel only if it belongs to this Telegram user. */
export async function ownedChannel(userId: number, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data } = await db
    .from("channels")
    .select("*")
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();
  return data;
}

// ─────────────────────────────────────────
//  validation helpers
// ─────────────────────────────────────────
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Telegram HTML parse mode only needs & < > escaped. */
export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return /^[\p{L}\p{M} '’.-]{2,60}$/u.test(s) ? s : null;
}

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function localDate(tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD
}

/** Asks Aladhan whether it can resolve this city (so we never save a dead location). */
export async function checkCity(
  country: string,
  city: string,
  method: number,
  tz: string,
): Promise<"ok" | "invalid" | "unavailable"> {
  const [y, m, d] = localDate(tz).split("-");
  const url =
    `https://api.aladhan.com/v1/timingsByCity/${d}-${m}-${y}` +
    `?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=${method}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status >= 500) return "unavailable";
    const json = await res.json();
    return json.code === 200 ? "ok" : "invalid";
  } catch {
    return "unavailable";
  }
}
