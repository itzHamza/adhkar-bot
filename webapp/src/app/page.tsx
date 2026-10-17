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
type GlobalAzkar = {
  id: string;
  slot: Slot;
  body: string;
  send_time: string | null;
  days_of_week: number[];
  hidden: boolean;
};
type Location = { country: string; city: string; timezone: string; prayer_method: number };
type Detail = {
  channel: ChannelRow & Location;
  features: Record<string, boolean>;
  slotTimes: Record<Slot, string>;
  azkar: Azkar[];
  globalAzkar: GlobalAzkar[];
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
  morning: "أذكار الصباح",
  evening: "أذكار المساء",
  sleep: "أذكار النوم",
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
//  adhkar manager (grouped list + edit/delete + add)
// ─────────────────────────────────────────
type FormValue = {
  slot: AzkarSlot;
  body: string;
  send_time: string | null;
  days_of_week: number[];
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function AzkarForm({
  initial,
  slotLocked,
  submitLabel,
  resetOnSuccess,
  onSubmit,
  onCancel,
}: {
  initial: { text: string; slot: AzkarSlot; time: string | null; days: number[] };
  slotLocked?: boolean;
  submitLabel: string;
  resetOnSuccess?: boolean;
  onSubmit: (v: FormValue) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [slot, setSlot] = useState<AzkarSlot>(initial.slot);
  const [withTime, setWithTime] = useState(initial.time !== null);
  const [time, setTime] = useState(initial.time ?? "08:00");
  const [days, setDays] = useState<number[]>(initial.days);
  const [busy, setBusy] = useState(false);

  const timed = slot === "custom" || withTime;
  const toggleDay = (d: number) =>
    setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()));

  const submit = async () => {
    setBusy(true);
    const ok = await onSubmit({
      slot,
      body: text,
      send_time: timed ? time : null,
      days_of_week: days,
    });
    setBusy(false);
    if (ok && resetOnSuccess) setText("");
  };

  return (
    <div className="space-y-2">
      <textarea
        className={`${inputCls} min-h-24`}
        placeholder="اكتب الذكر هنا (نص عادي)…"
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {!slotLocked && (
        <select value={slot} onChange={(e) => setSlot(e.target.value as AzkarSlot)} className={inputCls}>
          {(Object.keys(SLOT_LABEL) as AzkarSlot[]).map((s) => (
            <option key={s} value={s}>
              {SLOT_LABEL[s]}
            </option>
          ))}
        </select>
      )}

      {slot !== "custom" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />
          وقت خاص بهاذ الذكر (بدل وقت {SLOT_LABEL[slot]})
        </label>
      )}

      {timed && (
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

      <div className="flex gap-2">
        <button
          className={btnCls}
          onClick={submit}
          disabled={busy || !text.trim() || (timed && (!days.length || !time))}
        >
          {busy ? "…" : submitLabel}
        </button>
        {onCancel && (
          <button className="rounded-xl px-4 py-2 ring-1 ring-hint/30" onClick={onCancel}>
            إلغاء
          </button>
        )}
      </div>
    </div>
  );
}

type Item = {
  key: string;
  id: string;
  source: "global" | "own";
  slot: AzkarSlot;
  body: string; // stored (HTML-escaped) form
  send_time: string | null;
  days_of_week: number[];
  enabled: boolean;
};

const GROUPS: { slot: AzkarSlot; title: string }[] = [
  { slot: "morning", title: "🌅 أذكار الصباح" },
  { slot: "evening", title: "🌇 أذكار المساء" },
  { slot: "sleep", title: "🌙 أذكار النوم" },
  { slot: "custom", title: "⏰ أذكار بوقت مخصص" },
];

function AzkarManager({
  d,
  initData,
  id,
  notify,
  reload,
}: {
  d: Detail;
  initData: string;
  id: string;
  notify: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);

  const items: Item[] = [
    ...d.globalAzkar.map((g) => ({
      key: `g:${g.id}`,
      id: g.id,
      source: "global" as const,
      slot: g.slot,
      body: g.body,
      send_time: g.send_time,
      days_of_week: g.days_of_week,
      enabled: !g.hidden,
    })),
    ...d.azkar.map((a) => ({
      key: `o:${a.id}`,
      id: a.id,
      source: "own" as const,
      slot: a.slot,
      body: a.body,
      send_time: a.send_time,
      days_of_week: a.days_of_week,
      enabled: a.is_enabled,
    })),
  ];

  const api = (path: string, init: RequestInit) =>
    call(initData, `/api/channels/${id}${path}`, init);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) notify(okMsg);
      await reload();
      return true;
    } catch (e) {
      notify(errMsg(e));
      return false;
    }
  };

  const toggle = (it: Item) =>
    run(() =>
      it.source === "own"
        ? api(`/azkar/${it.id}`, { method: "PATCH", body: JSON.stringify({ is_enabled: !it.enabled }) })
        : api(`/global/${it.id}`, { method: "PATCH", body: JSON.stringify({ hidden: it.enabled }) }),
    );

  const remove = async (it: Item) => {
    if (!(await ask("حذف هذا الذكر نهائيا؟"))) return;
    await run(() => api(`/azkar/${it.id}`, { method: "DELETE" }));
  };

  const saveEdit = (it: Item) => async (v: FormValue) => {
    const payload = JSON.stringify({
      body: v.body,
      send_time: v.send_time,
      days_of_week: v.days_of_week,
    });
    const ok = await run(
      () =>
        it.source === "own"
          ? api(`/azkar/${it.id}`, { method: "PATCH", body: payload })
          : api(`/global/${it.id}`, { method: "POST", body: payload }),
      "✅ تم الحفظ",
    );
    if (ok) setEditing(null);
    return ok;
  };

  const add = (v: FormValue) =>
    run(() => api("/azkar", { method: "POST", body: JSON.stringify(v) }), "✅ تمت الإضافة");

  const toggleExpanded = (key: string) =>
    setExpanded((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  return (
    <>
      {GROUPS.map((g) => {
        const rows = items.filter((i) => i.slot === g.slot);
        const slotRow = SLOT_ROWS.find((s) => s.slot === g.slot);
        const slotOff = slotRow ? !d.features[slotRow.feature] : !d.features.custom_azkar;
        const untimedActive = rows.filter((i) => i.enabled && !i.send_time).length;

        return (
          <Section key={g.slot} title={g.title}>
            {slotRow && (
              <p className="text-xs text-hint">
                وقت الإرسال: <span dir="ltr">{d.slotTimes[slotRow.slot]}</span>
                {untimedActive > 1 && " · ذكر واحد كل يوم بالتناوب"}
              </p>
            )}
            {slotOff && (
              <p className="text-xs text-danger">
                ⚠️ هاذ القسم موقوف من الأعلى، ما يتبعت منو شي حتى تفعّلو.
              </p>
            )}
            {rows.length === 0 && <p className="text-sm text-hint">ما كاين حتى ذكر.</p>}

            {rows.map((it) => (
              <div
                key={it.key}
                className={`space-y-2 rounded-xl bg-bg p-3 ${it.enabled ? "" : "opacity-60"}`}
              >
                {editing === it.key ? (
                  <>
                    {it.source === "global" && (
                      <p className="text-xs text-hint">
                        غادي تتخلق نسخة خاصة بيك بالتعديل، وتتوقف النسخة العامة في قناتك.
                      </p>
                    )}
                    <AzkarForm
                      initial={{
                        text: decodeHtml(it.body),
                        slot: it.slot,
                        time: it.send_time,
                        days: it.days_of_week,
                      }}
                      slotLocked
                      submitLabel="حفظ"
                      onSubmit={saveEdit(it)}
                      onCancel={() => setEditing(null)}
                    />
                  </>
                ) : (
                  <>
                    <p
                      className={`whitespace-pre-line text-sm ${
                        expanded.includes(it.key) ? "" : "line-clamp-3"
                      }`}
                    >
                      {decodeHtml(it.body)}
                    </p>
                    {it.body.length > 120 && (
                      <button className="text-xs text-btn" onClick={() => toggleExpanded(it.key)}>
                        {expanded.includes(it.key) ? "إخفاء" : "عرض الكل"}
                      </button>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-hint">
                        {it.source === "global" ? "عام" : "خاص بي"}
                        {it.send_time && (
                          <>
                            {" · "}
                            <span dir="ltr">{it.send_time}</span>
                            {it.days_of_week.length < 7 &&
                              ` · ${it.days_of_week.map((x) => DAYS[x]).join("، ")}`}
                          </>
                        )}
                      </span>
                      <div className="flex items-center gap-3">
                        <button className="text-sm text-btn" onClick={() => setEditing(it.key)}>
                          تعديل
                        </button>
                        {it.source === "own" && (
                          <button className="text-sm text-danger" onClick={() => remove(it)}>
                            حذف
                          </button>
                        )}
                        <Switch checked={it.enabled} onChange={() => toggle(it)} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </Section>
        );
      })}

      <Section title="➕ إضافة ذكر">
        <AzkarForm
          initial={{ text: "", slot: "custom", time: "08:00", days: ALL_DAYS }}
          submitLabel="إضافة"
          resetOnSuccess
          onSubmit={add}
        />
      </Section>
    </>
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

      <AzkarManager d={d} initData={initData} id={id} notify={notify} reload={load} />

      <Section title="🎧 صوتيات القرآن">
        <p className="text-sm text-hint">قريبا…</p>
      </Section>

      <Section title="📍 المدينة">
        <LocationEditor ch={d.channel} onSave={saveLocation} />
      </Section>

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
