import type source from '@/i18n/locales/en/stats';

const stats = {
  "stats.title": "Statistiques d’écoute",
  "stats.description": "Ce que vous avez écouté, d’après l’historique d’écoute d’Amply.",
  "stats.range.label": "Période",
  "stats.range.7d": "7 derniers jours",
  "stats.range.30d": "30 derniers jours",
  "stats.range.all": "Depuis toujours",
  "stats.empty.title": "Aucune écoute sur cette période",
  "stats.empty.body": "Écoutez quelques titres et vos statistiques s’afficheront ici.",
  "stats.tiles.listeningTime": "Temps d’écoute",
  "stats.tiles.plays": "Écoutes",
  "stats.tiles.songs": "Titres",
  "stats.tiles.artists": "Artistes",
  "stats.tiles.streak": "Jours d’affilée",
  "stats.days_one": "{count} jour",
  "stats.days_other": "{count} jours",
  "stats.plays_one": "{count} écoute",
  "stats.plays_other": "{count} écoutes",
  "stats.charts.perDay": "Écoute par jour",
  "stats.charts.perDayLast30": "Écoute par jour, 30 derniers jours",
  "stats.charts.byHour": "Écoutes selon l’heure",
  "stats.charts.showTable": "Tableau",
  "stats.charts.showChart": "Graphique",
  "stats.top.songs": "Titres les plus écoutés",
  "stats.top.artists": "Artistes les plus écoutés",
  "stats.top.genres": "Genres les plus écoutés",
  "stats.top.empty": "Rien pour l’instant.",
  "stats.time.hoursMinutes": "{hours} h {minutes} min",
  "stats.time.minutes": "{minutes} min",
} satisfies Record<keyof typeof source, string>;

export default stats;
