// Throttled send queue.
//  - global:   ~25 msg/s  (Telegram limit ≈ 30/s)
//  - per chat: 1 msg / 3.1s (≈ 20 msg/min per group/channel)
//  - 429  → waits retry_after then retries
//  - 5xx / network errors → retries with backoff
//  - everything else (403, 400...) → rejects so the caller can react

const GLOBAL_INTERVAL_MS = 40;
const PER_CHAT_INTERVAL_MS = 3100;
const MAX_ATTEMPTS = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jobs = [];
const lastSentAt = new Map(); // chatId -> timestamp
let pumping = false;

function enqueue(chatId, run) {
  return new Promise((resolve, reject) => {
    jobs.push({ chatId, run, resolve, reject, notBefore: 0, attempts: 0 });
    pump();
  });
}

function errorCode(err) {
  return err?.response?.body?.error_code ?? err?.response?.statusCode ?? null;
}

function retryAfterMs(err) {
  const ra = err?.response?.body?.parameters?.retry_after;
  return ra ? ra * 1000 + 500 : null;
}

function isTransient(err) {
  const code = errorCode(err);
  if (code !== null) return code >= 500;
  return err?.code === "EFATAL" || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED/.test(err?.message ?? "");
}

function onFailure(job, err) {
  job.attempts += 1;
  const wait =
    errorCode(err) === 429
      ? retryAfterMs(err) ?? 5000
      : isTransient(err)
        ? 5000 * job.attempts
        : null;

  if (wait === null || job.attempts >= MAX_ATTEMPTS) return job.reject(err);

  job.notBefore = Date.now() + wait;
  jobs.push(job);
  pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (jobs.length) {
      const now = Date.now();
      const i = jobs.findIndex(
        (j) =>
          j.notBefore <= now &&
          now - (lastSentAt.get(j.chatId) ?? 0) >= PER_CHAT_INTERVAL_MS,
      );
      if (i === -1) {
        await sleep(100);
        continue;
      }
      const [job] = jobs.splice(i, 1);
      lastSentAt.set(job.chatId, Date.now());
      job.run().then(job.resolve, (err) => onFailure(job, err));
      await sleep(GLOBAL_INTERVAL_MS);
    }
  } finally {
    pumping = false;
    if (lastSentAt.size > 2000) {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [k, v] of lastSentAt) if (v < cutoff) lastSentAt.delete(k);
    }
  }
}

module.exports = { enqueue, size: () => jobs.length };
