import type source from '@/i18n/locales/en/stats';

const stats = {
  "stats.title": "收听统计",
  "stats.description": "根据 Amply 自己的收听记录，看看你最近在听什么。",
  "stats.range.label": "时间范围",
  "stats.range.7d": "最近 7 天",
  "stats.range.30d": "最近 30 天",
  "stats.range.all": "全部时间",
  "stats.empty.title": "此时间范围内还没有收听记录",
  "stats.empty.body": "播放几首歌曲后，你的统计数据就会显示在这里。",
  "stats.tiles.listeningTime": "收听时长",
  "stats.tiles.plays": "播放次数",
  "stats.tiles.songs": "歌曲",
  "stats.tiles.artists": "艺人",
  "stats.tiles.streak": "连续收听",
  "stats.days_one": "{count} 天",
  "stats.days_other": "{count} 天",
  "stats.plays_one": "{count} 次播放",
  "stats.plays_other": "{count} 次播放",
  "stats.charts.perDay": "每日收听时长",
  "stats.charts.perDayLast30": "每日收听时长（最近 30 天）",
  "stats.charts.byHour": "各时段播放次数",
  "stats.charts.showTable": "表格",
  "stats.charts.showChart": "图表",
  "stats.top.songs": "热门歌曲",
  "stats.top.artists": "热门艺人",
  "stats.top.genres": "热门流派",
  "stats.top.empty": "暂无数据。",
  "stats.time.hoursMinutes": "{hours} 小时 {minutes} 分钟",
  "stats.time.minutes": "{minutes} 分钟",
} satisfies Record<keyof typeof source, string>;

export default stats;
