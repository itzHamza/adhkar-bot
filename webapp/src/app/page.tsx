"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CITIES } from "@/lib/cities";

declare global {
  interface Window {
    Telegram?: { WebApp: any };
  }
}

// ─────────────────────────────────────────
//  types & constants
// ─────────────────────────────────────────
type Slot = "morning" | "evening" | "sleep";
type AzkarSlot = Slot | "custom";
type ChannelRow = { id: string; title: string | null; username: string | null; is_active: boolean };
type Azkar = {
  id: string;
  slot: AzkarSlot;
  body: string;
  send_time: string | null;
  days_of_week: number[];
  is_enabled: boolean;
};
type Location = { country: string; city: string; timezone: string; prayer_method: number };
type Detail = {
  channel: ChannelRow & Location;
  features: Record<string, boolean>;
  slotTimes: Record<Slot, string>;
  azkar: Azkar[];
};

const PRAYERS = [
  ["prayer_fajr", "الفجر"],
  ["prayer_dhuhr", "الظهر"],
  ["prayer_asr", "العصر"],
  ["prayer_maghrib", "المغرب"],
  ["prayer_isha", "العشاء"],
] as const;

const SLOT_ROWS: { slot: Slot; feature: string; label: string }[] = [
  { slot: "morning", feature: "azkar_morning", label: "أذكار الصباح" },
  { slot: "evening", feature: "azkar_evening", label: "أذكار المساء" },
  { slot: "sleep", feature: "azkar_sleep", label: "أذكار النوم" },
];

const SLOT_LABEL: Record<AzkarSlot, string> = {
  custom: "وقت مخصص",
  morning: "بديل أذكار الصباح",
  evening: "بديل أذكار المساء",
  sleep: "بديل أذكار النوم",
};

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]; // 0 = Sunday
const METHODS: [number, string][] = [
  [3, "رابطة العالم الإسلامي"],
  [4, "أم القرى"],
  [5, "الهيئة المصرية"],
  [2, "أمريكا الشمالية (ISNA)"],
];

const inputCls =
  "w-full rounded-xl bg-bg px-3 py-2 text-fg outline-none ring-1 ring-hint/30 focus:ring-btn";
const btnCls = "rounded-xl bg-btn px-4 py-2 font-medium text-btn-fg disabled:opacity-50";

// ─────────────────────────────────────────
//  helpers
// ─────────────────────────────────────────
async function call<T = any>(initData: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `tma ${initData}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "صرا خطأ، عاود.");
  return json as T;
}

// bodies are stored HTML-escaped (plain text only) — decode for display
const decodeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function ask(message: string): Promise<boolean> {
  const tg = window.Telegram?.WebApp;
  if (tg?.showConfirm) return new Promise((resolve) => tg.showConfirm(message, resolve));
  return Promise.resolve(window.confirm(message));
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "صرا خطأ، عاود.");

// ─────────────────────────────────────────
//  small UI pieces
// ─────────────────────────────────────────
function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      dir="ltr"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-btn" : "bg-hint/40"
      }`}
    >
      <span
        className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${
          checked ? "left-[1.375rem]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl bg-card p-4">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────
//  location editor
// ─────────────────────────────────────────
function LocationEditor({
  ch,
  onSave,
}: {
  ch: Detail["channel"];
  onSave: (l: Location) => Promise<boolean>;
}) {
  const isPreset = ch.country === "Algeria" && CITIES.some((c) => c.value === ch.city);
  const [mode, setMode] = useState<string>(isPreset ? ch.city : "__other");
  const [country, setCountry] = useState(ch.country);
  const [city, setCity] = useState(ch.city);
  const [tz, setTz] = useState(ch.timezone);
  const [method, setMethod] = useState(ch.prayer_method);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await onSave(
      mode === "__other"
        ? { country, city, timezone: tz, prayer_method: method }
        : { country: "Algeria", city: mode, timezone: "Africa/Algiers", prayer_method: method },
    );
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
        {CITIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
        <option value="__other">مدينة أخرى…</option>
      </select>

      {mode === "__other" && (
        <div className="space-y-2" dir="ltr">
          <input className={inputCls} placeholder="Country (e.g. France)" value={country} onChange={(e) => setCountry(e.target.value)} />
          <input className={inputCls} placeholder="City (e.g. Paris)" value={city} onChange={(e) => setCity(e.target.value)} />
          <input className={inputCls} placeholder="Timezone (e.g. Europe/Paris)" value={tz} onChange={(e) => setTz(e.target.value)} />
        </div>
      )}

      <select value={method} onChange={(e) => setMethod(Number(e.target.value))} className={inputCls}>
        {METHODS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>

      <button className={btnCls} onClick={save} disabled={busy}>
        {busy ? "جاري التحقق…" : "حفظ المدينة"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────
//  custom adhkar
// ─────────────────────────────────────────
function AzkarSection({
  items,
  initData,
  id,
  notify,
  reload,
}: {
  items: Azkar[];
  initData: string;
  id: string;
  notify: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [slot, setSlot] = useState<AzkarSlot>("custom");
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await call(initData, `/api/channels/${id}/azkar`, {
        method: "POST",
        body: JSON.stringify({
          slot,
          body: text,
          ...(slot === "custom" ? { send_time: time, days_of_week: days } : {}),
        }),
      });
      setText("");
      notify("✅ تمت الإضافة");
      await reload();
    } catch (e) {
      notify(errMsg(e));
    }
    setBusy(false);
  };

  const toggle = async (a: Azkar) => {
    try {
      await call(initData, `/api/channels/${id}/azkar/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_enabled: !a.is_enabled }),
      });
      await reload();
    } catch (e) {
      notify(errMsg(e));
    }
  };

  const remove = async (a: Azkar) => {
    if (!(await ask("حذف هذا الذكر؟"))) return;
    try {
      await call(initData, `/api/channels/${id}/azkar/${a.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      notify(errMsg(e));
    }
  };

  const toggleDay = (d: number) =>
    setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()));

  return (
    <Section title="✍️ أذكاري الخاصة">
      {items.length === 0 && <p className="text-sm text-hint">ما زدت حتى ذكر بعد.</p>}

      {items.map((a) => (
        <div key={a.id} className="space-y-2 rounded-xl bg-bg p-3">
          <p className="line-clamp-3 whitespace-pre-line text-sm">{decodeHtml(a.body)}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-hint">
              {SLOT_LABEL[a.slot]}
              {a.slot === "custom" &&
                ` · ${a.send_time} · ${a.days_of_week.length === 7 ? "كل يوم" : a.days_of_week.map((d) => DAYS[d]).join("، ")}`}
            </span>
            <div className="flex items-center gap-3">
              <button className="text-sm text-danger" onClick={() => remove(a)}>
                حذف
              </button>
              <Switch checked={a.is_enabled} onChange={() => toggle(a)} />
            </div>
          </div>
        </div>
      ))}

      <div className="space-y-2 border-t border-hint/20 pt-3">
        <textarea
          className={`${inputCls} min-h-24`}
          placeholder="اكتب الذكر هنا (نص عادي)…"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select value={slot} onChange={(e) => setSlot(e.target.value as AzkarSlot)} className={inputCls}>
          {(Object.keys(SLOT_LABEL) as AzkarSlot[]).map((s) => (
            <option key={s} value={s}>
              {SLOT_LABEL[s]}
            </option>
          ))}
        </select>
        {slot !== "custom" && (
          <p className="text-xs text-hint">
            هاذا الذكر غادي يعوّض الأذكار العامة في هاذ الوقت (ويتبعت بدلها).
          </p>
        )}
        {slot === "custom" && (
          <>
            <input type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    days.includes(i) ? "bg-btn text-btn-fg" : "bg-bg ring-1 ring-hint/30"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </>
        )}
        <button className={btnCls} onClick={add} disabled={busy || !text.trim() || (slot === "custom" && !days.length)}>
          {busy ? "…" : "إضافة"}
        </button>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────
//  channel detail
// ─────────────────────────────────────────
function ChannelDetail({
  initData,
  id,
  notify,
}: {
  initData: string;
  id: string;
  notify: (m: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await call<Detail>(initData, `/api/channels/${id}`));
    } catch (e) {
      notify(errMsg(e));
    }
  }, [initData, id, notify]);

  useEffect(() => {
    load();
  }, [load]);

  if (!d) return <p className="p-6 text-center text-hint">جاري التحميل…</p>;

  const patch = (body: object) =>
    call(initData, `/api/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) });

  const setFeature = async (key: string, value: boolean) => {
    setD((p) => p && { ...p, features: { ...p.features, [key]: value } });
    try {
      await patch({ features: { [key]: value } });
    } catch (e) {
      setD((p) => p && { ...p, features: { ...p.features, [key]: !value } });
      notify(errMsg(e));
    }
  };

  const setTime = async (slot: Slot, value: string) => {
    if (!value) return;
    const prev = d.slotTimes[slot];
    setD((p) => p && { ...p, slotTimes: { ...p.slotTimes, [slot]: value } });
    try {
      await patch({ slotTimes: { [slot]: value } });
    } catch (e) {
      setD((p) => p && { ...p, slotTimes: { ...p.slotTimes, [slot]: prev } });
      notify(errMsg(e));
    }
  };

  const saveLocation = async (location: Location) => {
    try {
      await patch({ location });
      notify("✅ تم الحفظ");
      await load();
      return true;
    } catch (e) {
      notify(errMsg(e));
      return false;
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-bold">{d.channel.title}</h1>
        {!d.channel.is_active && (
          <p className="mt-1 text-sm text-danger">
            ⚠️ البوت ما يقدرش ينشر في هاذ القناة. رجّعو admin مع صلاحية النشر.
          </p>
        )}
      </header>

      <Section title="🕌 تذكير الصلاة">
        {PRAYERS.map(([key, label]) => (
          <Row key={key} label={label}>
            <Switch checked={d.features[key]} onChange={(v) => setFeature(key, v)} />
          </Row>
        ))}
      </Section>

      <Section title="📿 الأذكار">
        {SLOT_ROWS.map((s) => (
          <div key={s.slot} className="flex items-center justify-between gap-3">
            <span>{s.label}</span>
            <div className="flex items-center gap-2">
              <input
                type="time"
                dir="ltr"
                value={d.slotTimes[s.slot]}
                onChange={(e) => setTime(s.slot, e.target.value)}
                className="rounded-lg bg-bg px-2 py-1 ring-1 ring-hint/30"
              />
              <Switch checked={d.features[s.feature]} onChange={(v) => setFeature(s.feature, v)} />
            </div>
          </div>
        ))}
        <Row label="الأذكار الخاصة بي">
          <Switch checked={d.features.custom_azkar} onChange={(v) => setFeature("custom_azkar", v)} />
        </Row>
      </Section>

      <Section title="🎧 صوتيات القرآن">
        <p className="text-sm text-hint">قريبا…</p>
      </Section>

      <Section title="📍 المدينة">
        <LocationEditor ch={d.channel} onSave={saveLocation} />
      </Section>

      <AzkarSection items={d.azkar} initData={initData} id={id} notify={notify} reload={load} />
    </div>
  );
}

// ─────────────────────────────────────────
//  page
// ─────────────────────────────────────────
export default function Page() {
  const [initData, setInitData] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();
    setInitData(tg?.initData ?? "");
  }, []);

  useEffect(() => {
    if (!initData) return;
    call<{ channels: ChannelRow[] }>(initData, "/api/channels")
      .then((r) => setChannels(r.channels))
      .catch((e) => setLoadError(errMsg(e)));
  }, [initData]);

  // Telegram's native back button
  useEffect(() => {
    const back = window.Telegram?.WebApp?.BackButton;
    if (!back) return;
    const onBack = () => setSelected(null);
    if (selected) {
      back.show();
      back.onClick(onBack);
    } else {
      back.hide();
    }
    return () => back.offClick(onBack);
  }, [selected]);

  let content: ReactNode;
  if (initData === null) {
    content = <p className="p-6 text-center text-hint">جاري التحميل…</p>;
  } else if (initData === "") {
    content = <p className="p-6 text-center">افتح هاذ الصفحة من داخل تيليغرام عبر البوت.</p>;
  } else if (loadError) {
    content = <p className="p-6 text-center text-danger">{loadError}</p>;
  } else if (!channels) {
    content = <p className="p-6 text-center text-hint">جاري التحميل…</p>;
  } else if (selected) {
    content = <ChannelDetail key={selected} initData={initData} id={selected} notify={notify} />;
  } else if (channels.length === 0) {
    content = (
      <div className="space-y-2 p-6 text-center">
        <p className="font-bold">ما عندك حتى قناة مربوطة</p>
        <p className="text-sm text-hint">زيد البوت admin في قناتك مع صلاحية Post Messages وتظهر هنا.</p>
      </div>
    );
  } else {
    content = (
      <div className="space-y-3">
        <h1 className="text-lg font-bold">قنواتي</h1>
        {channels.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c.id)}
            className="flex w-full items-center justify-between rounded-2xl bg-card p-4 text-start"
          >
            <span>
              <span className="block font-medium">{c.title}</span>
              {c.username && (
                <span className="block text-sm text-hint" dir="ltr">
                  @{c.username}
                </span>
              )}
            </span>
            <span>{c.is_active ? "🟢" : "🔴"}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4 pb-16">
      {content}
      {toast && (
        <div className="fixed inset-x-4 bottom-4 mx-auto max-w-md rounded-xl bg-fg px-4 py-3 text-center text-sm text-bg shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}
