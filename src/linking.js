const db = require("./db");

const MAX_CHANNELS_PER_USER = 5;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );

async function upsertUser(from) {
  await db.from("users").upsert(
    {
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
    },
    { onConflict: "telegram_id" },
  );
}

async function isUserBanned(telegramId) {
  const { data } = await db
    .from("users")
    .select("is_banned")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return !!data?.is_banned;
}

/**
 * Verifies everything, then creates/reactivates the channel row.
 * Returns { ok: true, channel, isNew } or { ok: false, reason }.
 */
async function registerChannel(bot, botId, chat, ownerId) {
  if (chat.type !== "channel") {
    return { ok: false, reason: "هاذي ماشي قناة. حاليا ندعمو القنوات فقط." };
  }
  if (await isUserBanned(ownerId)) {
    return { ok: false, reason: "حسابك محظور من استعمال البوت." };
  }

  // 1. the bot must be an admin that can post
  let botMember;
  try {
    botMember = await bot.getChatMember(chat.id, botId);
  } catch {
    return {
      ok: false,
      reason: "ما قدرتش نوصل للقناة. زيد البوت كـ admin أول.",
    };
  }
  if (botMember.status !== "administrator" || !botMember.can_post_messages) {
    return {
      ok: false,
      reason:
        "البوت لازم يكون admin مع صلاحية <b>نشر الرسائل</b> (Post Messages).",
    };
  }

  // 2. the user must be creator/admin of that channel
  let userMember;
  try {
    userMember = await bot.getChatMember(chat.id, ownerId);
  } catch {
    return { ok: false, reason: "ما قدرتش نتأكد من صلاحياتك في القناة." };
  }
  if (!["creator", "administrator"].includes(userMember.status)) {
    return { ok: false, reason: "لازم تكون admin في القناة باش تربطها." };
  }

  // 3. existing row checks
  const { data: existing } = await db
    .from("channels")
    .select("id, owner_id, is_active, is_banned")
    .eq("chat_id", chat.id)
    .maybeSingle();

  if (existing?.is_banned) {
    return { ok: false, reason: "هاذي القناة محظورة." };
  }
  if (existing && existing.owner_id !== ownerId && existing.is_active) {
    return {
      ok: false,
      reason: "القناة مربوطة بحساب admin آخر. خليه يفصلها أول من /mychannels.",
    };
  }
  if (!existing) {
    const { count } = await db
      .from("channels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId);
    if ((count ?? 0) >= MAX_CHANNELS_PER_USER) {
      return {
        ok: false,
        reason: `وصلت الحد الأقصى (${MAX_CHANNELS_PER_USER} قنوات).`,
      };
    }
  }

  // 4. create / reactivate (owner transfer only if the old link was inactive)
  const { data, error } = await db
    .from("channels")
    .upsert(
      {
        chat_id: chat.id,
        username: chat.username ?? null,
        title: chat.title ?? null,
        owner_id: ownerId,
        is_active: true,
      },
      { onConflict: "chat_id" },
    )
    .select()
    .single();

  if (error) {
    console.error("registerChannel:", error.message);
    return { ok: false, reason: "صرا خطأ في قاعدة البيانات، عاود بعد شوية." };
  }
  return { ok: true, channel: data, isNew: !existing };
}

function successText(channel, isNew) {
  return (
    `✅ ${isNew ? "تم ربط" : "تم تفعيل"} القناة <b>${esc(channel.title)}</b>\n\n` +
    `الإعدادات الافتراضية: مواقيت الصلاة (الجزائر العاصمة) + أذكار الصباح والمساء والنوم.\n` +
    `تعدّل كلشي (الصلوات، الأذكار، المدينة) من زر ⚙️ تحت أو من /settings`
  );
}

/** Bot's own membership changed in some chat (added / promoted / removed). */
async function handleMyChatMember(bot, botId, upd) {
  const chat = upd.chat;
  if (chat.type !== "channel") return;

  const member = upd.new_chat_member;
  const from = upd.from;

  if (member.status === "administrator" && member.can_post_messages) {
    if (from.is_bot) return;
    await upsertUser(from);
    const res = await registerChannel(bot, botId, chat, from.id);
    const text = res.ok
      ? successText(res.channel, res.isNew)
      : `❌ ما قدرتش نربط <b>${esc(chat.title)}</b>:\n${res.reason}`;
    // works only if the user already pressed /start in a private chat
    await bot
      .sendMessage(from.id, text, {
        parse_mode: "HTML",
        ...(res.ok ? settingsOpts() : {}),
      })
      .catch(() => {});
    return;
  }

  // removed, demoted, or lost the post permission → stop sending
  const { data: ch } = await db
    .from("channels")
    .update({ is_active: false })
    .eq("chat_id", chat.id)
    .select("owner_id, title")
    .maybeSingle();

  if (ch) {
    await bot
      .sendMessage(
        ch.owner_id,
        `⚠️ البوت ما بقاش يقدر ينشر في <b>${esc(ch.title)}</b> وتوقف الإرسال.\n` +
          `رجّعو admin مع صلاحية النشر وغادي يتفعل من جديد.`,
        { parse_mode: "HTML" },
      )
      .catch(() => {});
  }
}

/** Inline "open settings" button (Mini App). Empty object if WEBAPP_URL isn't set. */
function settingsOpts() {
  const url = process.env.WEBAPP_URL;
  return url
    ? {
        reply_markup: {
          inline_keyboard: [[{ text: "⚙️ فتح الإعدادات", web_app: { url } }]],
        },
      }
    : {};
}

module.exports = {
  settingsOpts,
  esc,
  upsertUser,
  registerChannel,
  successText,
  handleMyChatMember,
};
