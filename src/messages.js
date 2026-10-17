const PRAYER_AR = {
  fajr: "الفجر",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
};

function prayerMessage(key) {
  return (
    `🕌 قال تعالى :\n` +
    `<blockquote>إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَّوْقُوتًا</blockquote>\n` +
    `وقت صلاة ${PRAYER_AR[key]}\n` +
    `نوضوا تصلوا جماعة`
  );
}

module.exports = { PRAYER_AR, prayerMessage };
