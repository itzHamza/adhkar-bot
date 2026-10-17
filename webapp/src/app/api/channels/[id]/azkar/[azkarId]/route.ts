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

async function resolve(req: NextRequest, { params }: Ctx) {
  const auth = await authenticate(req);
  if (auth.res) return { res: auth.res } as const;
  const { id, azkarId } = await params;
  const ch = await ownedChannel(auth.user.id, id);
  if (!ch || !UUID_RE.test(azkarId)) return { res: fail(404, "غير موجود.") } as const;

  // the row must belong to THIS channel (global rows can never be edited here)
  const { data: row } = await db
    .from("azkar")
    .select("id, slot")
    .eq("id", azkarId)
    .eq("channel_id", ch.id)
    .maybeSingle();
  if (!row) return { res: fail(404, "غير موجود.") } as const;

  return { channelId: ch.id as string, row } as const;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("res" in r) return r.res;

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return fail(400, "طلب غير صالح.");

  const upd: Record<string, unknown> = {};

  if (b.is_enabled !== undefined) {
    if (typeof b.is_enabled !== "boolean") return fail(400, "طلب غير صالح.");
    upd.is_enabled = b.is_enabled;
  }
  if (b.body !== undefined) {
    const t = parseAzkarText(b.body);
    if ("error" in t) return fail(400, t.error);
    upd.body = t.text;
  }
  if (b.send_time !== undefined) {
    if (b.send_time === null) {
      if (r.row.slot === "custom") return fail(400, "وقت الإرسال مطلوب.");
      upd.send_time = null; // back to the slot's shared time
    } else if (typeof b.send_time === "string" && TIME_RE.test(b.send_time)) {
      upd.send_time = b.send_time;
    } else {
      return fail(400, "وقت غير صالح.");
    }
  }
  if (b.days_of_week !== undefined) {
    const d = parseDays(b.days_of_week);
    if (!d) return fail(400, "أيام غير صالحة.");
    upd.days_of_week = d;
  }
  if (!Object.keys(upd).length) return fail(400, "ما كاين شي يتبدل.");

  const { error } = await db
    .from("azkar")
    .update(upd)
    .eq("id", r.row.id)
    .eq("channel_id", r.channelId);
  if (error) return fail(500, "خطأ في الحفظ.");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("res" in r) return r.res;

  const { error } = await db
    .from("azkar")
    .delete()
    .eq("id", r.row.id)
    .eq("channel_id", r.channelId);
  if (error) return fail(500, "خطأ في الحذف.");
  return NextResponse.json({ ok: true });
}
