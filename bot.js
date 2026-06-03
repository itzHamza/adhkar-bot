const TelegramBot = require("node-telegram-bot-api");

// ─────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = "@tbiibe";

// ─────────────────────────────────────────
//  SCHEDULED MESSAGES
//  time format: "HH:MM" (24h, server timezone)
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
//  BOT INIT (polling enabled for /start)
// ─────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─────────────────────────────────────────
//  /start — preview all messages in DM
// ─────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    `🔍 *Preview mode* — sending all ${scheduledMessages.length} scheduled messages\\.`,
    { parse_mode: "MarkdownV2" },
  );

  for (const item of scheduledMessages) {
    await bot.sendMessage(chatId, `🕐 *Scheduled at ${item.time}*`, {
      parse_mode: "MarkdownV2",
    });
    await bot
      .sendMessage(chatId, item.message, { parse_mode: "MarkdownV2" })
      .catch(async (err) => {
        await bot.sendMessage(
          chatId,
          `❌ Failed to render this message:\n\`${err.message}\``,
          { parse_mode: "MarkdownV2" },
        );
      });
  }

  await bot.sendMessage(
    chatId,
    `✅ Done\\! If any message showed an error above, fix the markdown escaping for that entry\\.`,
    { parse_mode: "MarkdownV2" },
  );
});

// ─────────────────────────────────────────
//  SCHEDULER
// ─────────────────────────────────────────
function getCurrentHHMM() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function checkAndSend() {
  const currentTime = getCurrentHHMM();

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
          console.error(`❌ Failed to send [${item.time}]:`, err.message),
        );
    }
  }
}

// Check every minute
setInterval(checkAndSend, 60 * 1000);

console.log("🤖 Bot started. Scheduled messages:");
scheduledMessages.forEach((m) =>
  console.log(`  - ${m.time}: ${m.message.slice(0, 40)}...`),
);




