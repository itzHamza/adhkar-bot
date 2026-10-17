import { NextRequest, NextResponse } from "next/server";
import { authenticate, db, fail, ownedChannel } from "@/lib/server";

type Ctx = { params: Promise<{ id: string; azkarId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolve(req: NextRequest, { params }: Ctx) {
  const auth = await authenticate(req);
  if (auth.res) return { res: auth.res } as const;
  const { id, azkarId } = await params;
  const ch = await ownedChannel(auth.user.id, id);
  if (!ch || !UUID_RE.test(azkarId)) return { res: fail(404, "غير موجود.") } as const;
  return { channelId: ch.id as string, azkarId } as const;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("res" in r) return r.res;

  const b = await req.json().catch(() => null);
  if (!b || typeof b.is_enabled !== "boolean") return fail(400, "طلب غير صالح.");

  const { error } = await db
    .from("azkar")
    .update({ is_enabled: b.is_enabled })
    .eq("id", r.azkarId)
    .eq("channel_id", r.channelId); // row must belong to this channel
  if (error) return fail(500, "خطأ في الحفظ.");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("res" in r) return r.res;

  const { error } = await db
    .from("azkar")
    .delete()
    .eq("id", r.azkarId)
    .eq("channel_id", r.channelId);
  if (error) return fail(500, "خطأ في الحذف.");
  return NextResponse.json({ ok: true });
}
