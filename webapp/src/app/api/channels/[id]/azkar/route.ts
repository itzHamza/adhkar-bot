import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  db,
  escapeHtml,
  fail,
  ownedChannel,
  TIME_RE,
} from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

const SLOTS = ["custom", "morning", "evening", "sleep"];
const MAX_PER_CHANNEL = 30;
const MAX_RAW_LEN = 2000;
const MAX_STORED_LEN = 3500; // matches the CHECK constraint on azkar.body

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authenticate(req);
  if (auth.res) return auth.res;
  const ch = await ownedChannel(auth.user.id, (await params).id);
  if (!ch) return fail(404, "القناة غير موجودة.");

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return fail(400, "طلب غير صالح.");

  // slot
  if (typeof b.slot !== "string" || !SLOTS.includes(b.slot)) return fail(400, "نوع غير صالح.");

  // text: plain text only — escaped so users can't inject Telegram HTML tags
  if (typeof b.body !== "string") return fail(400, "النص مطلوب.");
  const raw = b.body
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  if (!raw) return fail(400, "النص مطلوب.");
  if (raw.length > MAX_RAW_LEN) return fail(400, `النص طويل (الحد ${MAX_RAW_LEN} حرف).`);
  const text = escapeHtml(raw);
  if (text.length > MAX_STORED_LEN) return fail(400, "النص طويل بزاف.");

  // time (only for custom)
  let sendTime: string | null = null;
  if (b.slot === "custom") {
    if (typeof b.send_time !== "string" || !TIME_RE.test(b.send_time)) {
      return fail(400, "اختر وقت الإرسال.");
    }
    sendTime = b.send_time;
  }

  // days
  let days = [0, 1, 2, 3, 4, 5, 6];
  if (b.days_of_week !== undefined) {
    if (
      !Array.isArray(b.days_of_week) ||
      !b.days_of_week.length ||
      !b.days_of_week.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
    ) {
      return fail(400, "أيام غير صالحة.");
    }
    days = [...new Set<number>(b.days_of_week)].sort();
  }

  // quota
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
      body: text,
      send_time: sendTime,
      days_of_week: days,
    })
    .select("id")
    .single();

  if (error) return fail(500, "خطأ في الحفظ.");
  return NextResponse.json({ id: data.id }, { status: 201 });
}
