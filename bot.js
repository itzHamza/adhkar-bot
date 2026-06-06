process.env.TZ = "Africa/Algiers"; // UTC+1 — all times in this file are Algeria time

const TelegramBot = require("node-telegram-bot-api");
const https = require("https");

// ─────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = "@tbiibe";

// Prayer calculation method — 3 = Muslim World League (used in Algeria)
// Full list: https://aladhan.com/prayer-times-api
const PRAYER_METHOD = 3;

// ─────────────────────────────────────────
//  PRAYER NAMES (EN → AR)
// ─────────────────────────────────────────
const PRAYER_NAMES = {
  Fajr: "الفجر",
  Dhuhr: "الظهر",
  Asr: "العصر",
  Maghrib: "المغرب",
  Isha: "العشاء",
};

const DAYS_AR = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];
const MONTHS_AR = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

// ─────────────────────────────────────────
//  SCHEDULED MESSAGES
// ─────────────────────────────────────────
const scheduledMessages = [
  {
    message: `🌅 من قال حين يصبح :\n> اللهم اني أصبحت أشهدك وأشهد حمله عرشك وملائكتك وجميع خلقك انك انت الله لا إله إلا انت وحدك لا شريك لك وان محمد عبدك ورسولك\nمن قالها أربعا أعتقَه الله من النار`,
    time: "08:30",
  },
  {
    message: `🌙 من قال حين يأوي إلى فراشِه :\n> \\( لا إله إلا اللهُ وحده لا شريك له ، له الملكُ ، وله الحمدُ ، وهو على كلِّ شيءٍ قديرٌ ، لاحولَ ولا قوةَ إلا بالله العليِّ العظيمِ ، سبحان اللهِ، والحمدُ لله ، ولا إله إلا اللهُ ، واللهُ أكبرُ \\)\nغُفِرَتْ له ذنوبُه ولو كانت مثلَ زَبَدِ البحرِ`,
    time: "23:50",
  },
];

// ─────────────────────────────────────────
//  PRAYER TIME STATE
// ─────────────────────────────────────────
let prayerTimesForToday = []; // [{ name, arabicName, time: "HH:MM" }]

function buildPrayerMessage(arabicName) {
  return (
    `🕌 قال تعالى :\n` +
    `> إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَّوْقُوتًا\n` +
    `وقت صلاة ${arabicName} \n` +
    `نوضوا تصلوا جماعة`
  );
}

async function fetchPrayerTimes() {
  return new Promise((resolve, reject) => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();

    const url = `https://api.aladhan.com/v1/timingsByCity/${dd}-${mm}-${yyyy}?city=Algiers&country=Algeria&method=${PRAYER_METHOD}`;

    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.code === 200) {
              const timings = json.data.timings;
              resolve(
                Object.entries(PRAYER_NAMES).map(([key, arabic]) => ({
                  name: key,
                  arabicName: arabic,
                  time: timings[key].substring(0, 5), // "HH:MM"
                })),
              );
            } else {
              reject(new Error("Aladhan API: " + json.status));
            }
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function refreshPrayerTimes() {
  try {
    prayerTimesForToday = await fetchPrayerTimes();
    console.log("🕌 Prayer times loaded (Algeria):");
    prayerTimesForToday.forEach((p) =>
      console.log(`  - ${p.arabicName}: ${p.time}`),
    );
  } catch (err) {
    console.error("❌ Failed to fetch prayer times:", err.message);
  }
}

// Refresh at 00:01 every night
function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 1, 0, 0); // next day 00:01
  const delay = midnight - now;
  setTimeout(() => {
    refreshPrayerTimes();
    scheduleMidnightRefresh();
  }, delay);
  console.log(
    `⏰ Next prayer-time refresh in ${Math.round(delay / 1000 / 60)} min`,
  );
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function escMd(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\-]/g, "\\$&");
}

function getCurrentHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// ─────────────────────────────────────────
//  BOT INIT
// ─────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─────────────────────────────────────────
//  /start — preview scheduled msgs + today's prayer times
// ─────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  // 1. Scheduled messages preview
  await bot.sendMessage(
    chatId,
    `🔍 *Preview* — ${scheduledMessages.length} scheduled messages:`,
    { parse_mode: "MarkdownV2" },
  );

  for (const item of scheduledMessages) {
    await bot.sendMessage(chatId, `🕐 *Scheduled at ${item.time}*`, {
      parse_mode: "MarkdownV2",
    });
    await bot
      .sendMessage(chatId, item.message, { parse_mode: "MarkdownV2" })
      .catch(async (err) => {
        await bot.sendMessage(chatId, `❌ Failed:\n\`${escMd(err.message)}\``, {
          parse_mode: "MarkdownV2",
        });
      });
  }

  // 2. Today's prayer times
  if (prayerTimesForToday.length === 0) {
    await bot.sendMessage(
      chatId,
      "⏳ Prayer times not loaded yet, try again in a moment\\.",
      {
        parse_mode: "MarkdownV2",
      },
    );
    return;
  }

  const now = new Date();
  const dateStr = `${DAYS_AR[now.getDay()]} ${now.getDate()} ${MONTHS_AR[now.getMonth()]} ${now.getFullYear()}`;

  let prayerList = `🕌 *مواقيت الصلاة اليوم*\n${escMd(dateStr)}\n\n`;
  for (const p of prayerTimesForToday) {
    prayerList += `${p.arabicName}  ·  *${p.time}*\n`;
  }

  await bot
    .sendMessage(chatId, prayerList, { parse_mode: "MarkdownV2" })
    .catch(async (err) => {
      await bot.sendMessage(
        chatId,
        `❌ Prayer list failed:\n\`${escMd(err.message)}\``,
        { parse_mode: "MarkdownV2" },
      );
    });

  await bot.sendMessage(
    chatId,
    `✅ Done\\! Any ❌ above means that message has a markdown issue\\.`,
    { parse_mode: "MarkdownV2" },
  );
});

// ─────────────────────────────────────────
//  SCHEDULER — runs every minute
// ─────────────────────────────────────────
function checkAndSend() {
  const currentTime = getCurrentHHMM();

  // Regular scheduled messages
  for (const item of scheduledMessages) {
    if (item.time === currentTime) {
      bot
        .sendMessage(CHANNEL_ID, item.message, { parse_mode: "MarkdownV2" })
        .then(() =>
          console.log(
            `✅ Sent [${item.time}]: ${item.message.slice(0, 40)}...`,
          ),
        )
        .catch((err) =>
          console.error(`❌ Failed [${item.time}]:`, err.message),
        );
    }
  }

  // Prayer reminders
  for (const prayer of prayerTimesForToday) {
    if (prayer.time === currentTime) {
      const msg = buildPrayerMessage(prayer.arabicName);
      bot
        .sendMessage(CHANNEL_ID, msg, { parse_mode: "MarkdownV2" })
        .then(() =>
          console.log(
            `🕌 Prayer reminder sent: ${prayer.arabicName} [${prayer.time}]`,
          ),
        )
        .catch((err) =>
          console.error(
            `❌ Prayer reminder failed [${prayer.arabicName}]:`,
            err.message,
          ),
        );
    }
  }
}

// ─────────────────────────────────────────
//  STARTUP
// ─────────────────────────────────────────
(async () => {
  await refreshPrayerTimes();
  scheduleMidnightRefresh();
  setInterval(checkAndSend, 60 * 1000);
  console.log("🤖 Bot started — timezone: Africa/Algiers");
  console.log("Scheduled messages:");
  scheduledMessages.forEach((m) =>
    console.log(`  - ${m.time}: ${m.message.slice(0, 40)}...`),
  );
})();
