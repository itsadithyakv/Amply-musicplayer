use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkSongInput {
    pub album_art: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtCount {
    pub art: String,
    pub count: u32,
}

#[tauri::command]
pub fn build_album_art_frequency_rust(songs: Vec<ArtworkSongInput>) -> Result<Vec<ArtCount>, String> {
    let mut freq: HashMap<String, u32> = HashMap::new();
    for song in songs {
        let art = match song.album_art {
            Some(value) if !value.is_empty() => value,
            _ => continue,
        };
        let entry = freq.entry(art).or_insert(0);
        *entry += 1;
    }

    Ok(freq
        .into_iter()
        .map(|(art, count)| ArtCount { art, count })
        .collect())
}
