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

type Ctx = { params: Promise<{ id: string }> };

const SLOTS = ["custom", "morning", "evening", "sleep"];
const MAX_PER_CHANNEL = 30;

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authenticate(req);
  if (auth.res) return auth.res;
  const ch = await ownedChannel(auth.user.id, (await params).id);
  if (!ch) return fail(404, "القناة غير موجودة.");

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return fail(400, "طلب غير صالح.");

  if (typeof b.slot !== "string" || !SLOTS.includes(b.slot)) return fail(400, "نوع غير صالح.");

  const t = parseAzkarText(b.body);
  if ("error" in t) return fail(400, t.error);

  // optional own time for built-in slots; required for "custom"
  let sendTime: string | null = null;
  if (b.send_time !== undefined && b.send_time !== null) {
    if (typeof b.send_time !== "string" || !TIME_RE.test(b.send_time)) {
      return fail(400, "وقت غير صالح.");
    }
    sendTime = b.send_time;
  }
  if (b.slot === "custom" && !sendTime) return fail(400, "اختر وقت الإرسال.");

  let days = [0, 1, 2, 3, 4, 5, 6];
  if (b.days_of_week !== undefined) {
    const d = parseDays(b.days_of_week);
    if (!d) return fail(400, "أيام غير صالحة.");
    days = d;
  }

  const { count } = await db
    .from("azkar")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", ch.id);
  if ((count ?? 0) >= MAX_PER_CHANNEL) {
    return fail(400, `وصلت الحد الأقصى (${MAX_PER_CHANNEL} ذكر).`);
  }

  const { data, error } = await db
    .from("azkar")
    .insert({
      channel_id: ch.id,
      slot: b.slot,
      body: t.text,
      send_time: sendTime,
      days_of_week: days,
    })
    .select("id")
    .single();

  if (error) return fail(500, "خطأ في الحفظ.");
  return NextResponse.json({ id: data.id }, { status: 201 });
}
