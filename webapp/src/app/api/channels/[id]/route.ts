import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  checkCity,
  cleanName,
  db,
  fail,
  isValidTz,
  ownedChannel,
  TIME_RE,
} from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

// quran_audio is intentionally absent until phase 5
const FEATURE_KEYS = [
  "prayer_fajr",
  "prayer_dhuhr",
  "prayer_asr",
  "prayer_maghrib",
  "prayer_isha",
  "azkar_morning",
  "azkar_evening",
  "azkar_sleep",
  "custom_azkar",
] as const;

const SLOTS = ["morning", "evening", "sleep"] as const;
const DEFAULT_TIMES: Record<(typeof SLOTS)[number], string> = {
  morning: "08:30",
  evening: "17:30",
  sleep: "23:50",
};
const METHODS = [2, 3, 4, 5];

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await authenticate(req);
  if (auth.res) return auth.res;
  const ch = await ownedChannel(auth.user.id, (await params).id);
  if (!ch) return fail(404, "القناة غير موجودة.");

  const [features, times, azkar] = await Promise.all([
    db.from("channel_features").select("*").eq("channel_id", ch.id).maybeSingle(),
    db.from("channel_slot_times").select("slot, send_time").eq("channel_id", ch.id),
    db
      .from("azkar")
      .select("id, slot, body, send_time, days_of_week, is_enabled")
      .eq("channel_id", ch.id)
      .order("created_at"),
  ]);
  if (features.error || times.error || azkar.error) {
    return fail(500, "خطأ في قاعدة البيانات.");
  }

  const slotTimes: Record<string, string> = { ...DEFAULT_TIMES };
  for (const t of times.data) slotTimes[t.slot] = String(t.send_time).slice(0, 5);

  return NextResponse.json({
    channel: {
      id: ch.id,
      title: ch.title,
      username: ch.username,
      is_active: ch.is_active,
      country: ch.country,
      city: ch.city,
      timezone: ch.timezone,
      prayer_method: ch.prayer_method,
    },
    features: Object.fromEntries(
      FEATURE_KEYS.map((k) => [k, features.data?.[k] ?? true]),
    ),
    slotTimes,
    azkar: azkar.data.map((a) => ({
      ...a,
      send_time: a.send_time ? String(a.send_time).slice(0, 5) : null,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authenticate(req);
  if (auth.res) return auth.res;
  const ch = await ownedChannel(auth.user.id, (await params).id);
  if (!ch) return fail(404, "القناة غير موجودة.");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "طلب غير صالح.");

  // ── validate everything first, then write ──
  let features: Record<string, boolean> | undefined;
  if (body.features !== undefined) {
    if (typeof body.features !== "object" || body.features === null) return fail(400, "طلب غير صالح.");
    features = {};
    for (const [k, v] of Object.entries(body.features)) {
      if (!(FEATURE_KEYS as readonly string[]).includes(k) || typeof v !== "boolean") {
        return fail(400, "إعداد غير معروف.");
      }
      features[k] = v;
    }
  }

  let slotRows: { channel_id: string; slot: string; send_time: string }[] | undefined;
  if (body.slotTimes !== undefined) {
    if (typeof body.slotTimes !== "object" || body.slotTimes === null) return fail(400, "طلب غير صالح.");
    slotRows = [];
    for (const [slot, time] of Object.entries(body.slotTimes)) {
      if (!(SLOTS as readonly string[]).includes(slot) || typeof time !== "string" || !TIME_RE.test(time)) {
        return fail(400, "وقت غير صالح.");
      }
      slotRows.push({ channel_id: ch.id, slot, send_time: time });
    }
  }

  let location: { country: string; city: string; timezone: string; prayer_method: number } | undefined;
  if (body.location !== undefined) {
    const l = body.location ?? {};
    const country = cleanName(l.country);
    const city = cleanName(l.city);
    const method = l.prayer_method ?? ch.prayer_method;
    if (!country || !city) return fail(400, "اسم الدولة أو المدينة غير صالح.");
    if (!isValidTz(l.timezone)) return fail(400, "المنطقة الزمنية غير صالحة (مثال: Africa/Algiers).");
    if (!METHODS.includes(method)) return fail(400, "طريقة الحساب غير مدعومة.");

    const status = await checkCity(country, city, method, l.timezone);
    if (status === "invalid") {
      return fail(400, "المدينة أو الدولة غير معروفة. جرب كتابتهم بالإنجليزية.");
    }
    if (status === "unavailable") {
      return fail(503, "تعذر التحقق من المدينة الآن، عاود بعد شوية.");
    }
    location = { country, city, timezone: l.timezone, prayer_method: method };
  }

  // ── apply ──
  if (features && Object.keys(features).length) {
    const { error } = await db.from("channel_features").update(features).eq("channel_id", ch.id);
    if (error) return fail(500, "خطأ في الحفظ.");
  }
  if (slotRows?.length) {
    const { error } = await db
      .from("channel_slot_times")
      .upsert(slotRows, { onConflict: "channel_id,slot" });
    if (error) return fail(500, "خطأ في الحفظ.");
  }
  if (location) {
    const { error } = await db.from("channels").update(location).eq("id", ch.id);
    if (error) return fail(500, "خطأ في الحفظ.");
  }

  return NextResponse.json({ ok: true });
}
