import type source from '@/i18n/locales/en/stats';

const stats = {
  "stats.title": "सुनने के आँकड़े",
  "stats.description": "आप क्या सुनते रहे हैं, Amply के अपने सुनने के इतिहास से।",
  "stats.range.label": "समय सीमा",
  "stats.range.7d": "पिछले 7 दिन",
  "stats.range.30d": "पिछले 30 दिन",
  "stats.range.all": "अब तक",
  "stats.empty.title": "इस अवधि में अभी तक कुछ नहीं सुना गया",
  "stats.empty.body": "कुछ गाने चलाएँ, आपके आँकड़े यहाँ दिखने लगेंगे।",
  "stats.tiles.listeningTime": "सुनने का समय",
  "stats.tiles.plays": "प्ले",
  "stats.tiles.songs": "गाने",
  "stats.tiles.artists": "कलाकार",
  "stats.tiles.streak": "लगातार दिन",
  "stats.days_one": "{count} दिन",
  "stats.days_other": "{count} दिन",
  "stats.plays_one": "{count} प्ले",
  "stats.plays_other": "{count} प्ले",
  "stats.charts.perDay": "रोज़ाना सुनने का समय",
  "stats.charts.perDayLast30": "रोज़ाना सुनने का समय, पिछले 30 दिन",
  "stats.charts.byHour": "दिन के समय के अनुसार प्ले",
  "stats.charts.showTable": "टेबल",
  "stats.charts.showChart": "चार्ट",
  "stats.top.songs": "टॉप गाने",
  "stats.top.artists": "टॉप कलाकार",
  "stats.top.genres": "टॉप शैलियाँ",
  "stats.top.empty": "अभी कुछ नहीं।",
  "stats.time.hoursMinutes": "{hours} घं. {minutes} मि.",
  "stats.time.minutes": "{minutes} मि.",
} satisfies Record<keyof typeof source, string>;

export default stats;
