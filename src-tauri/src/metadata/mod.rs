pub mod artist;
pub mod artwork;
pub mod cache;
pub mod genre;
pub mod http;
pub mod lyrics;
pub mod normalize;
pub mod tracklist;

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};


pub(crate) const ARTIST_CACHE_FOLDER: &str = "artist_cache";
pub(crate) const LYRICS_CACHE_FOLDER: &str = "lyrics_cache";
pub(crate) const LYRICS_INDEX_PATH: &str = "lyrics_cache/index.json";
pub(crate) const TRACK_ARTWORK_CACHE_PATH: &str = "metadata_cache/track_artwork_cache.json";
pub(crate) const ALBUM_TRACKLIST_CACHE_PATH: &str = "metadata_cache/album_tracklist_cache.json";
pub(crate) const SONG_GENRE_CACHE_PATH: &str = "metadata_cache/song_genre_cache.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistProfile {
    pub artist_name: String,
    pub summary: String,
    pub image_url: Option<String>,
    pub source_url: Option<String>,
    pub fetched_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistProfileLoadResult {
    pub status: String,
    pub profile: Option<ArtistProfile>,
    pub from_cache: Option<bool>,
    pub cache_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumTrack {
    pub position: u32,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumTracklist {
    pub key: String,
    pub album: String,
    pub artist: String,
    pub tracks: Vec<AlbumTrack>,
    pub source: String,
    pub fetched_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongInput {
    pub id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration: Option<f64>,
    pub genre: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongGenreCacheEntry {
    pub genre: String,
    pub fetched_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongGenreLoadResult {
    pub status: String,
    pub genre: Option<String>,
    pub from_cache: Option<bool>,
    pub cache_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsCandidate {
    pub id: String,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    pub duration_sec: Option<f64>,
    pub is_synced: bool,
    pub raw: String,
    pub preview: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLoadResult {
    pub status: String,
    pub raw: Option<String>,
    pub cache_path: String,
    pub from_cache: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSaveResult {
    pub status: String,
    pub raw: Option<String>,
    pub cache_path: String,
}

pub(crate) fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
