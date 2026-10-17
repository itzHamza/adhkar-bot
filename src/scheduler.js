const db = require("./db");
const queue = require("./queue");
const { getPrayerTimes, KEYS: PRAYER_KEYS } = require("./prayer");
const { prayerMessage } = require("./messages");
const { esc } = require("./linking");

const GRACE_MIN = 5; // send if the due time passed ≤ 5 min ago (covers restarts / drift)
const PAGE = 1000;
const DEFAULT_TZ = "Africa/Algiers";

const SLOTS = ["morning", "evening", "sleep"];
const FEATURE_OF_SLOT = {
  morning: "azkar_morning",
  evening: "azkar_evening",
  sleep: "azkar_sleep",
};
// used when a channel has no row in channel_slot_times
const DEFAULT_SLOT_TIMES = { morning: "07:30", evening: "17:30", sleep: "23:50" };

// ─────────────────────────────────────────
//  local time per timezone
// ─────────────────────────────────────────
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtCache = new Map();

function localNow(tz, at = new Date()) {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
        hourCycle: "h23",
      });
    } catch {
      return localNow(DEFAULT_TZ, at); // invalid tz string
    }
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const y = +p.year, m = +p.month, d = +p.day;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    min: +p.hour * 60 + +p.minute,
    dow: WEEKDAYS.indexOf(p.weekday),
    doy: Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000),
  };
}

const toMin = (t) => {
  const [h, m] = t.split(":");
  return +h * 60 + +m;
};
const isDue = (nowMin, time) => {
  const diff = nowMin - toMin(time);
  return diff >= 0 && diff <= GRACE_MIN;
};

// ─────────────────────────────────────────
//  data loading (paginated — PostgREST caps at 1000 rows)
// ─────────────────────────────────────────
async function fetchAll(build) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

const loadChannels = () =>
  fetchAll(() =>
    db
      .from("channels")
      .select("*, channel_features(*)")
      .eq("is_active", true)
      .eq("is_banned", false)
      .order("id"),
  );

async function loadAzkar() {
  const rows = await fetchAll(() =>
    db
      .from("azkar")
      .select("id, channel_id, slot, body, send_time, days_of_week")
      .eq("is_enabled", true)
      .order("id"),
  );
  const globalAzkar = { morning: [], evening: [], sleep: [] };
  const byChannel = new Map();
  for (const r of rows) {
    if (r.channel_id === null) {
      globalAzkar[r.slot]?.push(r);
    } else {
      if (!byChannel.has(r.channel_id)) byChannel.set(r.channel_id, []);
      byChannel.get(r.channel_id).push(r);
    }
  }
  return { globalAzkar, byChannel };
}

async function loadSlotTimes() {
  const rows = await fetchAll(() =>
    db.from("channel_slot_times").select("channel_id, slot, send_time").order("channel_id"),
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.channel_id)) map.set(r.channel_id, {});
    map.get(r.channel_id)[r.slot] = r.send_time.slice(0, 5);
  }
  return map;
}

// jobs already claimed in the last 15 min — avoids re-trying inserts every tick
async function loadRecentClaims() {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const rows = await fetchAll(() =>
    db.from("send_log").select("channel_id, job_key, local_date").gte("sent_at", since).order("id"),
  );
  return new Set(rows.map((r) => `${r.channel_id}|${r.job_key}|${r.local_date}`));
}

// ─────────────────────────────────────────
//  which jobs are due for one channel right now
// ─────────────────────────────────────────
async function dueJobs(ch, ctx) {
  const f = Array.isArray(ch.channel_features) ? ch.channel_features[0] : ch.channel_features;
  if (!f) return { jobs: [], local: null };

  const local = localNow(ch.timezone);
  const jobs = [];
  const push = (key, text) => {
    if (!ctx.claims.has(`${ch.id}|${key}|${local.date}`)) jobs.push({ key, text });
  };

  // 1. prayers
  if (PRAYER_KEYS.some((k) => f[`prayer_${k}`])) {
    const times = await getPrayerTimes(ch.country, ch.city, ch.prayer_method, local.date);
    if (times) {
      for (const k of PRAYER_KEYS) {
        if (f[`prayer_${k}`] && isDue(local.min, times[k])) push(`prayer:${k}`, prayerMessage(k));
      }
    }
  }

  // 2. built-in adhkar slots (channel's own rows override the global library)
  const own = ctx.azkar.byChannel.get(ch.id) ?? [];
  const slotTimes = ctx.slotTimes.get(ch.id) ?? {};
  for (const slot of SLOTS) {
    if (!f[FEATURE_OF_SLOT[slot]]) continue;

    const ownRows = own.filter((r) => r.slot === slot);
    const globalRows = ctx.azkar.globalAzkar[slot];

    // rows WITHOUT send_time rotate daily and go out at the slot time
    const ownUntimed = ownRows.filter((r) => !r.send_time);
    const pool = ownUntimed.length ? ownUntimed : globalRows.filter((r) => !r.send_time);
    if (pool.length && isDue(local.min, slotTimes[slot] ?? DEFAULT_SLOT_TIMES[slot])) {
      push(`azkar:${slot}`, pool[local.doy % pool.length].body);
    }

    // rows WITH send_time go out at their own time (each as its own message)
    for (const r of [...globalRows, ...ownRows]) {
      if (
        r.send_time &&
        r.days_of_week.includes(local.dow) &&
        isDue(local.min, r.send_time.slice(0, 5))
      ) {
        push(`azkar:${r.id}`, r.body);
      }
    }
  }

  // 3. custom adhkar with their own time/days
  if (f.custom_azkar) {
    for (const r of own) {
      if (
        r.slot === "custom" &&
        r.days_of_week.includes(local.dow) &&
        isDue(local.min, r.send_time.slice(0, 5))
      ) {
        push(`azkar:${r.id}`, r.body);
      }
    }
  }

  return { jobs, local };
}

// ─────────────────────────────────────────
//  delivery: claim → queue → mark result
// ─────────────────────────────────────────
async function claim(ch, key, date) {
  const { error } = await db
    .from("send_log")
    .insert({ channel_id: ch.id, job_key: key, local_date: date, status: "pending" });
  if (!error) return true;
  if (error.code === "23505") return false; // already claimed (unique violation)
  throw error;
}

const setStatus = (ch, key, date, status, error = null) =>
  db
    .from("send_log")
    .update({ status, error, sent_at: new Date().toISOString() })
    .eq("channel_id", ch.id)
    .eq("job_key", key)
    .eq("local_date", date);

function isPermanent(err) {
  const body = err?.response?.body;
  const code = body?.error_code;
  const desc = body?.description ?? "";
  return (
    code === 403 ||
    (code === 400 && /chat not found|not enough rights|have no rights|CHAT_WRITE_FORBIDDEN/i.test(desc))
  );
}

async function deactivate(bot, ch) {
  await db.from("channels").update({ is_active: false }).eq("id", ch.id);
  await bot
    .sendMessage(
      ch.owner_id,
      `⚠️ توقف الإرسال في <b>${esc(ch.title)}</b> لأن البوت ما بقاش يقدر ينشر فيها.\n` +
        `رجّعو admin مع صلاحية النشر وغادي يتفعل من جديد.`,
      { parse_mode: "HTML" },
    )
    .catch(() => {});
}

async function deliver(bot, ch, job, date) {
  if (!(await claim(ch, job.key, date))) return;

  try {
    await queue.enqueue(ch.chat_id, () =>
      bot.sendMessage(ch.chat_id, job.text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    );
    await setStatus(ch, job.key, date, "sent");
    console.log(`✅ [${ch.title}] ${job.key}`);
  } catch (err) {
    const msg = String(err?.response?.body?.description ?? err.message).slice(0, 500);
    await setStatus(ch, job.key, date, "failed", msg);
    console.error(`❌ [${ch.title}] ${job.key}: ${msg}`);
    if (isPermanent(err)) await deactivate(bot, ch);
  }
}

// ─────────────────────────────────────────
//  tick (every minute)
// ─────────────────────────────────────────
let running = false;

async function tick(bot) {
  if (running) return;
  running = true;
  try {
    const channels = await loadChannels();
    if (!channels.length) return;

    const ctx = {
      azkar: await loadAzkar(),
      slotTimes: await loadSlotTimes(),
      claims: await loadRecentClaims(),
    };

    for (const ch of channels) {
      let { jobs, local } = await dueJobs(ch, ctx);
      if (!jobs.length) continue;

      // daily limit (pending + sent count)
      const { count } = await db
        .from("send_log")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", ch.id)
        .eq("local_date", local.date)
        .in("status", ["pending", "sent"]);
      const room = ch.max_posts_per_day - (count ?? 0);
      if (room <= 0) {
        console.warn(`⛔ [${ch.title}] daily limit reached`);
        continue;
      }
      jobs = jobs.slice(0, room);

      // fire-and-forget: the queue handles pacing, the tick must not wait for it
      for (const job of jobs) {
        deliver(bot, ch, job, local.date).catch((e) =>
          console.error(`deliver error [${ch.title}] ${job.key}:`, e.message),
        );
      }
    }
  } finally {
    running = false;
  }
}

function startScheduler(bot) {
  const loop = async () => {
    await tick(bot).catch((e) => console.error("tick error:", e.message));
    setTimeout(loop, 60_000 - (Date.now() % 60_000) + 250); // align to the next minute
  };
  loop();
  console.log("⏰ Scheduler started");
}

module.exports = { startScheduler };