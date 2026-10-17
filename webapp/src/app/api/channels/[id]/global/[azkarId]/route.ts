import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  db,
  fail,
  ownedChannel,
  parseAzkarText,
  parseDays,
  TIME_RE,
} from "@/lib/server";

type Ctx = { params: Promise<{ id: string; azkarId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_CHANNEL = 30;

async function resolve(req: NextRequest, { params }: Ctx) {
  const auth = await authenticate(req);
  if (auth.res) return { res: auth.res } as const;
  const { id, azkarId } = await params;
  const ch = await ownedChannel(auth.user.id, id);
  if (!ch || !UUID_RE.test(azkarId)) return { res: fail(404, "غير موجود.") } as const;

  // must be a shared (global) built-in dhikr
  const { data: g } = await db
    .from("azkar")
    .select("id, slot, send_time, days_of_week")
    .eq("id", azkarId)
    .is("channel_id", null)
    .eq("is_enabled", true)
    .in("slot", ["morning", "evening", "sleep"])
    .maybeSingle();
  if (!g) return { res: fail(404, "غير موجود.") } as const;

  return { channelId: ch.id as string, g } as const;
}

/** Body: { hidden: boolean } — stops/restores this shared dhikr for THIS channel only. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("res" in r) return r.res;

  const b = await req.json().catch(() => null);
  if (!b || typeof b.hidden !== "boolean") return fail(400, "طلب غير صالح.");

  const q = b.hidden
    ? db
        .from("channel_azkar_hidden")
        .upsert({ channel_id: r.channelId, azkar_id: r.g.id }, { onConflict: "channel_id,azkar_id" })
    : db
        .from("channel_azkar_hidden")
        .delete()
        .eq("channel_id", r.channelId)
        .eq("azkar_id", r.g.id);

  const { error } = await q;
  if (error) return fail(500, "خطأ في الحفظ.");
  return NextResponse.json({ ok: true });
}

/**
 * "Edit" a shared dhikr: creates the channel's own edited copy (same slot) and
 * hides the original for this channel. The shared text itself is never changed.
 * Body: { body, send_time?: string|null, days_of_week? } (omitted fields copy the original)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("res" in r) return r.res;

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return fail(400, "طلب غير صالح.");

  const t = parseAzkarText(b.body);
  if ("error" in t) return fail(400, t.error);

  let sendTime: string | null = r.g.send_time ? String(r.g.send_time).slice(0, 5) : null;
  if (b.send_time !== undefined) {
    if (b.send_time === null) sendTime = null;
    else if (typeof b.send_time === "string" && TIME_RE.test(b.send_time)) sendTime = b.send_time;
    else return fail(400, "وقت غير صالح.");
  }

  let days: number[] = r.g.days_of_week;
  if (b.days_of_week !== undefined) {
    const d = parseDays(b.days_of_week);
    if (!d) return fail(400, "أيام غير صالحة.");
    days = d;
  }

  const { count } = await db
    .from("azkar")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", r.channelId);
  if ((count ?? 0) >= MAX_PER_CHANNEL) {
    return fail(400, `وصلت الحد الأقصى (${MAX_PER_CHANNEL} ذكر).`);
  }

  const { data: copy, error } = await db
    .from("azkar")
    .insert({
      channel_id: r.channelId,
      slot: r.g.slot,
      body: t.text,
      send_time: sendTime,
      days_of_week: days,
    })
    .select("id")
    .single();
  if (error) return fail(500, "خطأ في الحفظ.");

  const { error: hideErr } = await db
    .from("channel_azkar_hidden")
    .upsert({ channel_id: r.channelId, azkar_id: r.g.id }, { onConflict: "channel_id,azkar_id" });
  if (hideErr) {
    // best-effort rollback so the user doesn't end up with a duplicate
    await db.from("azkar").delete().eq("id", copy.id);
    return fail(500, "خطأ في الحفظ.");
  }

  return NextResponse.json({ id: copy.id }, { status: 201 });
}
