use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use chrono::{DateTime, Timelike, Utc};

const DAY_SEC: i64 = 86_400;

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongInput {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub duration: f64,
    pub track: u32,
    pub added_at: i64,
    pub play_count: u32,
    pub last_played: Option<i64>,
    pub favorite: bool,
    pub skip_count: Option<u32>,
    pub total_play_seconds: Option<f64>,
    pub manual_queue_adds: Option<u32>,
    pub loudness_lufs: Option<f64>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub count: u32,
    pub last_played: i64,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningProfileInput {
    pub hourly: Vec<u32>,
    pub weekday: Vec<u32>,
    pub recent_artists: HashMap<String, RecentEntry>,
    pub recent_genres: HashMap<String, RecentEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistOutput {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub playlist_type: String,
    pub song_ids: Vec<String>,
    pub updated_at: i64,
}

#[derive(Clone, Copy)]
struct Rng32 {
    state: u32,
}

impl Rng32 {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next_f32(&mut self) -> f32 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut r = self.state;
        r = r ^ (r >> 15);
        r = r.wrapping_mul(1 | r);
        r ^= r.wrapping_add((r ^ (r >> 7)).wrapping_mul(61 | r));
        ((r ^ (r >> 14)) as f64 / 4_294_967_296.0) as f32
    }
}

fn hash_str(value: &str) -> u32 {
    let mut h: i32 = 0;
    for ch in value.chars() {
        h = (h << 5).wrapping_sub(h).wrapping_add(ch as i32);
    }
    h.unsigned_abs()
}

fn rng_for(seed: u64, salt: &str) -> Rng32 {
    let combined = format!("{salt}:{seed}");
    Rng32::new(hash_str(&combined))
}

fn seeded_shuffle(mut songs: Vec<SongInput>, seed: u64, salt: &str) -> Vec<SongInput> {
    let mut rng = rng_for(seed, salt);
    let mut i = songs.len();
    while i > 1 {
        i -= 1;
        let j = (rng.next_f32() * (i as f32 + 1.0)).floor() as usize;
        songs.swap(i, j);
    }
    songs
}

fn get_primary_artist(name: &str) -> String {
    let lowered = name.to_lowercase();
    let splitters = [" feat. ", " ft. ", " featuring ", " & ", " / ", ",", " x "];
    for splitter in splitters {
        if let Some((left, _)) = lowered.split_once(splitter) {
            return left.trim().to_string();
        }
    }
    lowered.trim().to_string()
}

fn album_key(song: &SongInput) -> Option<String> {
    let artist = get_primary_artist(&song.artist);
    let album = song.album.trim().to_lowercase();
    if album.is_empty() {
        return None;
    }
    Some(format!("{artist}::{album}"))
}

fn artist_key(song: &SongInput) -> String {
    get_primary_artist(&song.artist)
}

fn normalize_genre_bucket(genre_raw: &str) -> Option<&'static str> {
    let genre = genre_raw.trim().to_lowercase();
    if genre.is_empty() || genre == "unknown genre" {
        return None;
    }
    let rules: [(&str, &[&str]); 11] = [
        ("Pop", &["pop", "k-pop", "kpop"]),
        ("Rock", &["rock", "alt", "alternative", "punk", "grunge"]),
        ("Hip-Hop", &["hip hop", "hip-hop", "rap", "trap"]),
        ("Electronic", &["electronic", "edm", "dance", "house", "techno", "trance", "dubstep"]),
        ("R&B", &["r&b", "soul", "neo soul"]),
        ("Indie", &["indie", "lofi", "lo-fi"]),
        ("Jazz", &["jazz", "swing", "bebop"]),
        ("Classical", &["classical", "orchestral", "symphony"]),
        ("Country", &["country", "americana"]),
        ("Latin", &["latin", "reggaeton", "salsa", "bachata"]),
        ("World", &["world", "bollywood", "hindi", "indian", "afro", "afrobeat"]),
    ];
    for (label, keywords) in rules.iter() {
        if keywords.iter().any(|k| genre.contains(k)) {
            return Some(*label);
        }
    }
    None
}

fn genre_bucket(song: &SongInput) -> String {
    if let Some(bucket) = normalize_genre_bucket(&song.genre) {
        return bucket.to_string();
    }
    let raw = song.genre.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("unknown genre") {
        "Unknown Genre".to_string()
    } else {
        raw.to_string()
    }
}

fn get_skip_rate(song: &SongInput) -> f32 {
    let skips = song.skip_count.unwrap_or(0) as f32;
    let plays = song.play_count as f32;
    if skips <= 0.0 || plays <= 0.0 {
        return 0.0;
    }
    (skips / plays).min(1.0)
}

fn get_listen_ratio(song: &SongInput) -> Option<f32> {
    if song.duration <= 0.0 {
        return None;
    }
    let total = song.total_play_seconds.unwrap_or(0.0);
    let plays = song.play_count as f32;
    if total <= 0.0 || plays <= 0.0 {
        return None;
    }
    Some(((total as f32) / (plays * song.duration as f32)).clamp(0.0, 1.0))
}

fn get_exploration_boost(song: &SongInput, now: i64) -> f32 {
    let plays = song.play_count as i64;
    let recent_penalty = song
        .last_played
        .map(|lp| (now - lp) as f32 / DAY_SEC as f32)
        .map(|days| (4.0 - days).max(0.0))
        .unwrap_or(0.0);
    let low_play_boost = if plays <= 1 { 2.4 } else if plays <= 3 { 1.4 } else { 0.4 };
    (low_play_boost - recent_penalty * 0.8).max(0.0)
}

fn get_trend_boost(song: &SongInput, profile: &Option<ListeningProfileInput>) -> f32 {
    let profile = match profile {
        Some(p) => p,
        None => return 0.0,
    };
    let artist = artist_key(song);
    let artist_count = profile.recent_artists.get(&artist).map(|e| e.count).unwrap_or(0) as f32;
    let genre = song.genre.trim().to_lowercase();
    let genre_count = profile.recent_genres.get(&genre).map(|e| e.count).unwrap_or(0) as f32;
    (artist_count * 0.25 + genre_count * 0.12).min(4.0)
}

fn get_daypart(hour: u32) -> u32 {
    if hour < 6 {
        0
    } else if hour < 12 {
        1
    } else if hour < 18 {
        2
    } else {
        3
    }
}

fn get_time_of_day_boost(song: &SongInput, profile: &Option<ListeningProfileInput>, now: i64) -> f32 {
    let profile = match profile {
        Some(p) => p,
        None => return 0.0,
    };
    let last_played = match song.last_played {
        Some(lp) => lp,
        None => return 0.0,
    };
    let now_hour = DateTime::<Utc>::from_timestamp(now, 0)
        .map(|dt| dt.hour() as u32)
        .unwrap_or(0);
    let last_hour = DateTime::<Utc>::from_timestamp(last_played, 0)
        .map(|dt| dt.hour() as u32)
        .unwrap_or(0);
    if get_daypart(now_hour) != get_daypart(last_hour) {
        return 0.0;
    }
    if profile.hourly.is_empty() {
        return 0.0;
    }
    let max_hour = profile.hourly.iter().cloned().max().unwrap_or(1).max(1) as f32;
    let affinity = profile.hourly.get(now_hour as usize).cloned().unwrap_or(0) as f32 / max_hour;
    affinity * 1.1
}

fn apply_recency_weight(song: &SongInput, now: i64, window_days: f32, mode: &str) -> f32 {
    let last_played = match song.last_played {
        Some(lp) => lp,
        None => return 1.05,
    };
    let age_days = (now - last_played) as f32 / DAY_SEC as f32;
    match mode {
        "prefer" => {
            let boost = 1.0 + ((window_days - age_days) / window_days).clamp(0.0, 1.0) * 0.7;
            boost.clamp(0.6, 1.7)
        }
        "avoid" => (age_days / window_days).clamp(0.25, 1.0),
        _ => 1.0,
    }
}

fn apply_added_weight(song: &SongInput, now: i64, window_days: f32) -> f32 {
    let age_days = (now - song.added_at) as f32 / DAY_SEC as f32;
    (1.4 - age_days / window_days).clamp(0.35, 1.4)
}

fn base_taste_score(song: &SongInput, now: i64, profile: &Option<ListeningProfileInput>, discovery: f32, randomness: f32) -> f32 {
    let favorite = if song.favorite { 1.4 * (1.0 - randomness * 0.5) } else { 0.0 };
    let play_boost = ((song.play_count as f32).sqrt() * 0.35).min(3.2) * (1.0 - randomness * 0.7);
    let completion = get_listen_ratio(song).unwrap_or(0.5) * 1.1;
    let trend = get_trend_boost(song, profile) * 0.45;
    let time_boost = get_time_of_day_boost(song, profile, now) * 0.35;
    let exploration = get_exploration_boost(song, now) * (0.45 + discovery * 0.6 + randomness * 0.9);
    let manual = (song.manual_queue_adds.unwrap_or(0) as f32 * 0.2).min(1.2);
    let skip_penalty = get_skip_rate(song) * 2.2;
    0.6 + favorite + play_boost + completion + trend + time_boost + exploration + manual - skip_penalty
}

fn weighted_sample_unique(
    pool: &[SongInput],
    count: usize,
    weight_for: impl Fn(&SongInput) -> f32,
    rng: &mut Rng32,
) -> Vec<SongInput> {
    if count == 0 || pool.is_empty() {
        return Vec::new();
    }
    let mut items: Vec<SongInput> = pool.to_vec();
    let mut result = Vec::with_capacity(count);

    while !items.is_empty() && result.len() < count {
        let mut total = 0.0;
        let weights: Vec<f32> = items
            .iter()
            .map(|song| {
                let w = weight_for(song).max(0.0);
                total += w;
                w
            })
            .collect();
        if total <= 0.0 {
            break;
        }
        let mut pick = rng.next_f32() * total;
        let mut index = 0;
        for (i, w) in weights.iter().enumerate() {
            pick -= *w;
            if pick <= 0.0 {
                index = i;
                break;
            }
        }
        let chosen = items.swap_remove(index);
        result.push(chosen);
    }

    result
}

fn cap_by_album(songs: Vec<SongInput>, max_per_album: usize) -> Vec<SongInput> {
    if max_per_album == 0 || songs.len() <= 2 {
        return songs;
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut kept = Vec::new();
    for song in songs.iter() {
        let key = album_key(song).unwrap_or_else(|| format!("__unknown__{}", song.id));
        let used = *counts.get(&key).unwrap_or(&0);
        if used >= max_per_album {
            continue;
        }
        counts.insert(key, used + 1);
        kept.push(song.clone());
    }
    let min_keep = (songs.len() as f32 * 0.6).ceil().min(20.0) as usize;
    if kept.len() < min_keep {
        songs
    } else {
        kept
    }
}

fn shuffle_with_spacing(songs: Vec<SongInput>, seed: u64, salt: &str) -> Vec<SongInput> {
    let shuffled = seeded_shuffle(songs, seed, salt);
    let mut buckets: HashMap<String, Vec<SongInput>> = HashMap::new();
    for song in shuffled {
        buckets.entry(artist_key(&song)).or_default().push(song);
    }
    let keys: Vec<String> = buckets.keys().cloned().collect();
    let mut positions: HashMap<String, usize> = keys.iter().map(|k| (k.clone(), 0)).collect();
    let mut result: Vec<SongInput> = Vec::new();
    let mut last_key: Option<String> = None;

    while result.len() < buckets.values().map(|v| v.len()).sum::<usize>() {
        let mut best: Option<String> = None;
        let mut alt: Option<String> = None;
        let mut best_rem = -1isize;
        let mut alt_rem = -1isize;

        for key in keys.iter() {
            let pos = *positions.get(key).unwrap_or(&0);
            let remaining = buckets.get(key).map(|v| v.len().saturating_sub(pos)).unwrap_or(0) as isize;
            if remaining <= 0 {
                continue;
            }
            if Some(key) != last_key.as_ref() {
                if remaining > best_rem {
                    best_rem = remaining;
                    best = Some(key.clone());
                }
            } else if remaining > alt_rem {
                alt_rem = remaining;
                alt = Some(key.clone());
            }
        }

        let pick_key = best.or(alt);
        let pick_key = match pick_key {
            Some(k) => k,
            None => break,
        };
        let pos = *positions.get(&pick_key).unwrap_or(&0);
        if let Some(bucket) = buckets.get(&pick_key) {
            if let Some(song) = bucket.get(pos) {
                result.push(song.clone());
            }
        }
        positions.insert(pick_key.clone(), pos + 1);
        last_key = Some(pick_key);
    }

    result
}

fn curate_from_pool(
    seed: u64,
    salt: &str,
    count: usize,
    pool: &[SongInput],
    now: i64,
    profile: &Option<ListeningProfileInput>,
    discovery: f32,
    randomness: f32,
    recency_mode: &str,
    recency_days: f32,
    prefer_added: bool,
    added_days: f32,
) -> Vec<SongInput> {
    let mut rng = rng_for(seed, salt);
    let picks = weighted_sample_unique(pool, count, |song| {
        let mut score = base_taste_score(song, now, profile, discovery, randomness);
        if prefer_added {
            score *= apply_added_weight(song, now, added_days) * (1.0 + randomness * 0.6);
        }
        let recency_window = if recency_mode == "avoid" {
            recency_days * (1.0 + randomness * 1.5)
        } else {
            recency_days
        };
        score *= apply_recency_weight(song, now, recency_window, recency_mode);
        score.max(0.05)
    }, &mut rng);

    shuffle_with_spacing(picks, seed, &format!("{salt}:order"))
}

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

fn map_playlist(id: &str, name: &str, description: &str, songs: Vec<SongInput>) -> PlaylistOutput {
    PlaylistOutput {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        playlist_type: "smart".to_string(),
        song_ids: songs.into_iter().map(|s| s.id).collect(),
        updated_at: now_unix(),
    }
}

pub fn generate_playlists(
    songs: Vec<SongInput>,
    seed: u64,
    daily_seed: u64,
    profile: Option<ListeningProfileInput>,
    discovery: f32,
    randomness: f32,
    lite: bool,
) -> Vec<PlaylistOutput> {
    if songs.is_empty() {
        return Vec::new();
    }
    let discovery = if discovery.is_finite() { discovery } else { 0.5 }.clamp(0.0, 1.0);
    let randomness = if randomness.is_finite() { randomness } else { 0.3 }.clamp(0.0, 1.0);
    let now = now_unix();
    let max_per_album = (4.0 - randomness * 2.0).round().max(2.0) as usize;

    let recently_added_pool: Vec<SongInput> = {
        let mut list = songs.clone();
        list.sort_by(|a, b| b.added_at.cmp(&a.added_at));
        list.truncate(240.min(list.len()));
        list
    };
    let most_played_pool: Vec<SongInput> = {
        let mut list = songs.clone();
        list.sort_by(|a, b| b.play_count.cmp(&a.play_count));
        list.truncate(300.min(list.len()));
        list
    };
    let rediscover_pool: Vec<SongInput> = {
        let cutoff = now - 45 * DAY_SEC;
        let mut list: Vec<SongInput> = songs
            .iter()
            .cloned()
            .filter(|s| s.last_played.unwrap_or(0) < cutoff)
            .collect();
        list.sort_by(|a, b| a.last_played.unwrap_or(0).cmp(&b.last_played.unwrap_or(0)));
        list.truncate(240.min(list.len()));
        list
    };
    let favorites_pool: Vec<SongInput> = songs.iter().cloned().filter(|s| s.favorite).collect();
    let recently_played: Vec<SongInput> = {
        let mut list: Vec<SongInput> = songs.iter().cloned().filter(|s| s.last_played.is_some()).collect();
        list.sort_by(|a, b| b.last_played.unwrap_or(0).cmp(&a.last_played.unwrap_or(0)));
        list.truncate(120.min(list.len()));
        cap_by_album(list, max_per_album)
    };

    let daily_mix = curate_from_pool(daily_seed, "daily-mix", 60, &songs, now, &profile, discovery, randomness, "avoid", 3.0, false, 30.0);
    let daily_mix = cap_by_album(daily_mix, max_per_album);

    let on_repeat_pool: Vec<SongInput> = {
        let threshold = now - 14 * DAY_SEC;
        let recent: Vec<SongInput> = songs.iter().cloned().filter(|s| s.last_played.unwrap_or(0) >= threshold).collect();
        if recent.len() >= 20 { recent } else { songs.iter().cloned().filter(|s| s.play_count > 0).collect() }
    };
    let on_repeat = curate_from_pool(seed, "on-repeat", 80, &on_repeat_pool, now, &profile, 0.2, randomness, "prefer", 7.0, false, 30.0);
    let on_repeat = cap_by_album(on_repeat, (4.0 - randomness).round().max(2.0) as usize);

    let recently_added = curate_from_pool(seed, "recently-added", 80, &recently_added_pool, now, &profile, discovery, randomness, "neutral", 5.0, true, 30.0);
    let recently_added = cap_by_album(recently_added, max_per_album);

    let most_played = curate_from_pool(seed, "most-played", 80, &most_played_pool, now, &profile, discovery, randomness, "avoid", 5.0, false, 30.0);
    let most_played = cap_by_album(most_played, max_per_album);

    let rediscover = curate_from_pool(seed, "rediscover", 80, &rediscover_pool, now, &profile, discovery, randomness, "avoid", 30.0, false, 30.0);
    let rediscover = cap_by_album(rediscover, max_per_album);

    let favorites = curate_from_pool(seed, "favorites", 80, &favorites_pool, now, &profile, discovery, randomness, "avoid", 4.0, false, 30.0);
    let favorites = cap_by_album(favorites, max_per_album);

    let quick_hits_pool: Vec<SongInput> = songs.iter().cloned().filter(|s| s.duration > 0.0 && s.duration <= 180.0).collect();
    let quick_hits = curate_from_pool(seed, "quick-hits", 80, &quick_hits_pool, now, &profile, discovery, randomness, "avoid", 4.0, false, 30.0);
    let quick_hits = cap_by_album(quick_hits, max_per_album);

    let long_sessions_pool: Vec<SongInput> = songs.iter().cloned().filter(|s| s.duration >= 360.0).collect();
    let long_sessions = curate_from_pool(seed, "long-sessions", 80, &long_sessions_pool, now, &profile, discovery, randomness, "avoid", 5.0, false, 30.0);
    let long_sessions = cap_by_album(long_sessions, max_per_album);

    let deep_cuts_pool: Vec<SongInput> = songs.iter().cloned().filter(|s| s.play_count <= 1 && s.added_at < now - 21 * DAY_SEC).collect();
    let deep_cuts = curate_from_pool(seed, "deep-cuts", 80, &deep_cuts_pool, now, &profile, discovery, randomness, "avoid", 45.0, false, 30.0);
    let deep_cuts = cap_by_album(deep_cuts, max_per_album);

    let loved_played_pool: Vec<SongInput> = songs.iter().cloned().filter(|s| s.favorite && s.play_count > 0).collect();
    let loved_played = curate_from_pool(seed, "loved-played", 80, &loved_played_pool, now, &profile, discovery, randomness, "avoid", 4.0, false, 30.0);
    let loved_played = cap_by_album(loved_played, max_per_album);

    let explore_pool: Vec<SongInput> = songs.iter().cloned().filter(|s| s.play_count <= 4).collect();
    let explore = curate_from_pool(seed, "explore", 80, &explore_pool, now, &profile, discovery, randomness, "avoid", 4.0, false, 30.0);
    let explore = cap_by_album(explore, max_per_album);

    let mut playlists = vec![
        map_playlist("smart_daily_mix", "Daily Mix", "Fresh daily mix with genre balance.", daily_mix),
        map_playlist("smart_on_repeat", "On Repeat", "Songs you have been playing most this week.", on_repeat),
        map_playlist("smart_recently_played", "Recently Played", "Tracks you listened to most recently.", recently_played.clone()),
        map_playlist("smart_recently_added", "Recently Added", "Latest tracks added to your library.", recently_added),
        map_playlist("smart_most_played", "Most Played", "Your most replayed songs.", most_played),
        map_playlist("smart_rediscover", "Rediscover", "Songs you have not played in a while.", rediscover),
        map_playlist("smart_favorites", "Favorites", "Your favorited songs.", favorites),
    ];

    if !loved_played_pool.is_empty() {
        playlists.push(map_playlist("smart_loved_played", "Loved & Played", "Favorites you keep coming back to.", loved_played));
    }
    if !quick_hits_pool.is_empty() {
        playlists.push(map_playlist("smart_quick_hits", "Quick Hits", "Short, punchy tracks under 3 minutes.", quick_hits));
    }
    if !long_sessions_pool.is_empty() {
        playlists.push(map_playlist("smart_long_sessions", "Long Sessions", "Longer tracks for deep listening.", long_sessions));
    }
    if !deep_cuts_pool.is_empty() {
        playlists.push(map_playlist("smart_deep_cuts", "Deep Cuts", "Less-played gems from your library.", deep_cuts));
    }
    if !explore_pool.is_empty() {
        playlists.push(map_playlist("smart_explore", "Explore", "New edges from your library, tuned for discovery.", explore));
    }

    if !lite {
        // Genre mixes (top 6)
        let mut by_genre: HashMap<String, Vec<SongInput>> = HashMap::new();
        for song in songs.iter().cloned() {
            let bucket = genre_bucket(&song);
            by_genre.entry(bucket).or_default().push(song);
        }
        let mut ranked: Vec<(String, Vec<SongInput>, u32)> = by_genre
            .into_iter()
            .map(|(g, list)| {
                let total: u32 = list.iter().map(|s| s.play_count).sum();
                (g, list, total)
            })
            .collect();
        ranked.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| b.1.len().cmp(&a.1.len())));
        for (genre, list, _) in ranked.into_iter().take(6) {
            let curated = curate_from_pool(seed, &format!("genre:{genre}"), 80, &list, now, &profile, discovery, randomness, "avoid", 4.0, false, 30.0);
            let capped = cap_by_album(curated, max_per_album);
            playlists.push(map_playlist(&format!("smart_genre_mix_{}", genre.to_lowercase().replace(' ', "-")), &format!("{genre} Mix"), &format!("Mix based on your {genre} tracks."), capped));
        }

        // Mood mixes (simple keyword scoring)
        let moods: Vec<(&str, &str, &str, &[&str], &[&str])> = vec![
            ("happy", "Happy Mix", "Upbeat songs to lift the mood.", &["pop","dance","disco","funk","edm","electronic"], &["happy","joy","smile","sun","bright","good"]),
            ("sad", "Sad Mix", "Slower, mellow tracks for quieter moments.", &["acoustic","ballad","ambient","lofi","lo-fi","piano"], &["sad","cry","alone","lonely","tears","heart"]),
            ("party", "Party Mix", "High-energy tracks for late-night sessions.", &["dance","edm","club","house","hip hop","hip-hop","rap","reggaeton"], &["party","club","dance","night","mix"]),
            ("chill", "Chill Mix", "Laid-back tracks for winding down.", &["chill","ambient","lofi","lo-fi","acoustic","indie"], &["chill","slow","late","night","blue"]),
            ("workout", "Workout Mix", "High-intensity tracks to keep you moving.", &["edm","electronic","rock","hip hop","hip-hop","metal"], &["run","burn","power","move","energy"]),
        ];
        for (id, name, desc, genre_hints, title_hints) in moods {
            let mut scored: Vec<(SongInput, f32)> = Vec::new();
            for song in songs.iter().cloned() {
                let raw_genre = song.genre.to_lowercase();
                let title = song.title.to_lowercase();
                let mut score = base_taste_score(&song, now, &profile, discovery, randomness);
                if genre_hints.iter().any(|g| raw_genre.contains(g)) {
                    score += 3.0;
                }
                if title_hints.iter().any(|t| title.contains(t)) {
                    score += 0.8;
                }
                scored.push((song, score));
            }
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let picked: Vec<SongInput> = scored.into_iter().take(80).map(|s| s.0).collect();
            if !picked.is_empty() {
                let capped = cap_by_album(picked, max_per_album);
                playlists.push(map_playlist(&format!("smart_{id}_mix"), name, desc, capped));
            }
        }
    }

    // remove empties
    playlists.retain(|p| !p.song_ids.is_empty());
    playlists
}
