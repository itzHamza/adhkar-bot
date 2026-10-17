const db = require("./db");

const KEYS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const API_KEYS = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

const memo = new Map(); // key -> { fajr: "HH:MM", ... }
const inflight = new Map(); // key -> Promise (dedupes parallel fetches)
const failedAt = new Map(); // key -> timestamp (cooldown after a failure)
const FAIL_COOLDOWN_MS = 5 * 60 * 1000;

const cacheKey = (country, city, method, date) =>
  `${country}|${city}|${method}|${date}`;

async function fromApi(country, city, method, date) {
  const [y, m, d] = date.split("-");
  const url =
    `https://api.aladhan.com/v1/timingsByCity/${d}-${m}-${y}` +
    `?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=${method}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json();
  if (json.code !== 200) throw new Error(`Aladhan: ${json.status}`);

  const out = {};
  for (const k of KEYS) out[k] = String(json.data.timings[API_KEYS[k]]).slice(0, 5);
  return out;
}

async function load(country, city, method, date) {
  // 1. DB cache (shared across restarts)
  const { data } = await db
    .from("prayer_times_cache")
    .select("fajr, dhuhr, asr, maghrib, isha")
    .eq("country", country)
    .eq("city", city)
    .eq("method", method)
    .eq("date", date)
    .maybeSingle();

  if (data) return Object.fromEntries(KEYS.map((k) => [k, data[k].slice(0, 5)]));

  // 2. Aladhan API, then store
  const times = await fromApi(country, city, method, date);
  await db
    .from("prayer_times_cache")
    .upsert(
      { country, city, method, date, ...times },
      { onConflict: "country,city,method,date" },
    );
  return times;
}

/** date = channel-local "YYYY-MM-DD". Returns { fajr, ... } ("HH:MM") or null on failure. */
async function getPrayerTimes(country, city, method, date) {
  const key = cacheKey(country, city, method, date);
  if (memo.has(key)) return memo.get(key);
  if (Date.now() - (failedAt.get(key) ?? 0) < FAIL_COOLDOWN_MS) return null;

  if (!inflight.has(key)) {
    inflight.set(
      key,
      load(country, city, method, date)
        .then((times) => {
          if (memo.size > 500) memo.clear();
          memo.set(key, times);
          return times;
        })
        .catch((err) => {
          failedAt.set(key, Date.now());
          console.error(`❌ Prayer times [${city}, ${country}]:`, err.message);
          return null;
        })
        .finally(() => inflight.delete(key)),
    );
  }
  return inflight.get(key);
}

module.exports = { getPrayerTimes, KEYS };
