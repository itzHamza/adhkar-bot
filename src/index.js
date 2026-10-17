require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
const {
  esc,
  upsertUser,
  registerChannel,
  successText,
  handleMyChatMember,
} = require("./linking");
const { startScheduler } = require("./scheduler");

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    params: {
      allowed_updates: ["message", "callback_query", "my_chat_member"],
    },
  },
});

let BOT_ID;
let BOT_USERNAME;

// users waiting to send a channel (forward or @username) after /addchannel
const pending = new Map(); // userId -> timestamp
const PENDING_TTL = 10 * 60 * 1000;

const UUID_RE = /^[0-9a-f-]{36}$/i;
const isPrivate = (msg) => msg.chat.type === "private";

const safe =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error("handler error:", err);
    }
  };

// ─────────────────────────────────────────
//  my_chat_member — bot added / promoted / removed
// ─────────────────────────────────────────
bot.on(
  "my_chat_member",
  safe((upd) => handleMyChatMember(bot, BOT_ID, upd)),
);

// ─────────────────────────────────────────
//  /start
// ─────────────────────────────────────────
bot.onText(
  /^\/start/,
  safe(async (msg) => {
    if (!isPrivate(msg)) return;
    await upsertUser(msg.from);

    await bot.sendMessage(
      msg.chat.id,
      `أهلا ${esc(msg.from.first_name)} 👋\n\n` +
        `هاذا بوت يبعت <b>مواقيت الصلاة والأذكار</b> في قناتك تلقائيا.\n\n` +
        `<b>كيفاش تبدا:</b>\n` +
        `1️⃣ زيد البوت <b>@${esc(BOT_USERNAME)}</b> admin في قناتك مع صلاحية <b>Post Messages</b>\n` +
        `2️⃣ القناة تتربط تلقائيا وتجيك رسالة تأكيد هنا\n\n` +
        `إذا ما تربطتش: /addchannel\n` +
        `قنواتك: /mychannels`,
      { parse_mode: "HTML" },
    );
  }),
);

// ─────────────────────────────────────────
//  /addchannel — manual fallback
// ─────────────────────────────────────────
bot.onText(
  /^\/addchannel/,
  safe(async (msg) => {
    if (!isPrivate(msg)) return;
    await upsertUser(msg.from);
    pending.set(msg.from.id, Date.now());
    await bot.sendMessage(
      msg.chat.id,
      `بعت لي <b>@username</b> تاع القناة، أو <b>Forward</b> أي رسالة منها.\n` +
        `(لازم البوت يكون admin فيها وأنت admin بالزاف)\n\n` +
        `للإلغاء: /cancel`,
      { parse_mode: "HTML" },
    );
  }),
);

bot.onText(
  /^\/cancel/,
  safe(async (msg) => {
    if (!isPrivate(msg)) return;
    pending.delete(msg.from.id);
    await bot.sendMessage(msg.chat.id, "تم الإلغاء.");
  }),
);

function channelFromMessage(msg) {
  if (msg.forward_origin?.type === "channel") return msg.forward_origin.chat;
  if (msg.forward_from_chat?.type === "channel") return msg.forward_from_chat;
  return null;
}

bot.on(
  "message",
  safe(async (msg) => {
    if (!isPrivate(msg)) return;
    if (msg.text?.startsWith("/")) return; // commands handled above

    const ts = pending.get(msg.from.id);
    if (!ts) return;
    if (Date.now() - ts > PENDING_TTL) {
      pending.delete(msg.from.id);
      return;
    }

    let chat = channelFromMessage(msg);
    if (!chat) {
      const m = msg.text
        ?.trim()
        .match(/^(?:https?:\/\/t\.me\/)?@?([A-Za-z]\w{4,31})$/);
      if (m) {
        chat = await bot.getChat(`@${m[1]}`).catch(() => null);
      }
    }
    if (!chat) {
      await bot.sendMessage(
        msg.chat.id,
        "ما فهمتش. بعت @username تاع قناة عامة، أو Forward رسالة من القناة.",
      );
      return;
    }

    pending.delete(msg.from.id);
    await upsertUser(msg.from);
    const res = await registerChannel(bot, BOT_ID, chat, msg.from.id);

    await bot.sendMessage(
      msg.chat.id,
      res.ok ? successText(res.channel, res.isNew) : `❌ ${res.reason}`,
      { parse_mode: "HTML" },
    );
  }),
);

// ─────────────────────────────────────────
//  /mychannels
// ─────────────────────────────────────────
bot.onText(
  /^\/mychannels/,
  safe(async (msg) => {
    if (!isPrivate(msg)) return;

    const { data: channels, error } = await db
      .from("channels")
      .select("id, title, username, is_active")
      .eq("owner_id", msg.from.id)
      .order("created_at");

    if (error) {
      await bot.sendMessage(msg.chat.id, "❌ خطأ، عاود بعد شوية.");
      return;
    }
    if (!channels.length) {
      await bot.sendMessage(msg.chat.id, "ما عندك حتى قناة مربوطة. /start");
      return;
    }

    const lines = channels.map(
      (c) =>
        `${c.is_active ? "🟢" : "🔴"} <b>${esc(c.title)}</b>` +
        (c.username ? ` (@${esc(c.username)})` : ""),
    );

    await bot.sendMessage(
      msg.chat.id,
      `📋 <b>قنواتك:</b>\n\n${lines.join("\n")}\n\n🔴 = البوت ما يقدرش ينشر (راجع صلاحياته)`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: channels.map((c) => [
            { text: `🗑 فصل ${c.title}`, callback_data: `unlink:${c.id}` },
          ]),
        },
      },
    );
  }),
);

// ─────────────────────────────────────────
//  Unlink (with confirmation)
// ─────────────────────────────────────────
bot.on(
  "callback_query",
  safe(async (q) => {
    const [action, id] = (q.data || "").split(":");
    if (!UUID_RE.test(id || "")) return bot.answerCallbackQuery(q.id);

    const { data: ch } = await db
      .from("channels")
      .select("id, title, owner_id")
      .eq("id", id)
      .maybeSingle();

    if (!ch || ch.owner_id !== q.from.id) {
      return bot.answerCallbackQuery(q.id, {
        text: "غير مسموح",
        show_alert: true,
      });
    }

    const target = {
      chat_id: q.message.chat.id,
      message_id: q.message.message_id,
    };

    if (action === "unlink") {
      await bot.editMessageText(
        `⚠️ تفصل <b>${esc(ch.title)}</b>؟\nغادي تتمسح كل إعداداتها وأذكارها الخاصة.`,
        {
          ...target,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ نعم، افصل", callback_data: `unlinkyes:${id}` },
                { text: "↩️ لا", callback_data: `unlinkno:${id}` },
              ],
            ],
          },
        },
      );
    } else if (action === "unlinkyes") {
      await db.from("channels").delete().eq("id", id).eq("owner_id", q.from.id);
      await bot.editMessageText(`🗑 تم فصل <b>${esc(ch.title)}</b>.`, {
        ...target,
        parse_mode: "HTML",
      });
    } else if (action === "unlinkno") {
      await bot.editMessageText("تم الإلغاء.", target);
    }
    await bot.answerCallbackQuery(q.id);
  }),
);

bot.on("polling_error", (e) => console.error("polling_error:", e.message));

// ─────────────────────────────────────────
//  startup
// ─────────────────────────────────────────
(async () => {
  const me = await bot.getMe();
  BOT_ID = me.id;
  BOT_USERNAME = me.username;
  console.log(`🤖 Bot started as @${BOT_USERNAME}`);
  startScheduler(bot);
})();
