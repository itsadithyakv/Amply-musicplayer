import type source from '@/i18n/locales/en/stats';

const stats = {
  "stats.title": "Estadísticas de escucha",
  "stats.description": "Lo que has estado escuchando, según el historial de escucha de Amply.",
  "stats.range.label": "Periodo",
  "stats.range.7d": "Últimos 7 días",
  "stats.range.30d": "Últimos 30 días",
  "stats.range.all": "Todo el tiempo",
  "stats.empty.title": "Aún no hay escuchas en este periodo",
  "stats.empty.body": "Reproduce algunas canciones y tus estadísticas aparecerán aquí.",
  "stats.tiles.listeningTime": "Tiempo de escucha",
  "stats.tiles.plays": "Reproducciones",
  "stats.tiles.songs": "Canciones",
  "stats.tiles.artists": "Artistas",
  "stats.tiles.streak": "Racha de días",
  "stats.days_one": "{count} día",
  "stats.days_other": "{count} días",
  "stats.plays_one": "{count} reproducción",
  "stats.plays_other": "{count} reproducciones",
  "stats.charts.perDay": "Escucha por día",
  "stats.charts.perDayLast30": "Escucha por día, últimos 30 días",
  "stats.charts.byHour": "Reproducciones por hora del día",
  "stats.charts.showTable": "Tabla",
  "stats.charts.showChart": "Gráfico",
  "stats.top.songs": "Canciones más escuchadas",
  "stats.top.artists": "Artistas más escuchados",
  "stats.top.genres": "Géneros más escuchados",
  "stats.top.empty": "Nada todavía.",
  "stats.time.hoursMinutes": "{hours} h {minutes} min",
  "stats.time.minutes": "{minutes} min",
} satisfies Record<keyof typeof source, string>;

export default stats;
