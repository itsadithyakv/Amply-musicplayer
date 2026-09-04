use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;

use super::SongInput;

static FEAT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bfeat\.?\b|\bft\.?\b|\bfeaturing\b").unwrap());
static PARENS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*[\(\[].*?[\)\]]").unwrap());
static NON_ALNUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static MULTISPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static TRACK_CLEAN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(remaster(ed)?|mono|stereo|bonus track|explicit|clean)\b").unwrap());

pub(crate) fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in canonicalize_stylized_text(value).trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

pub(crate) fn slugify_legacy(value: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

pub(crate) fn canonicalize_stylized_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '$' => out.push('s'),
            '!' => out.push('i'),
            '@' => out.push('a'),
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' | 'ă' | 'ą' | 'Á' | 'À' | 'Â' | 'Ä'
            | 'Ã' | 'Å' | 'Ā' | 'Ă' | 'Ą' => out.push('a'),
            'æ' | 'Æ' => out.push_str("ae"),
            'ç' | 'ć' | 'č' | 'ĉ' | 'ċ' | 'Ç' | 'Ć' | 'Č' | 'Ĉ' | 'Ċ' => out.push('c'),
            'ď' | 'đ' | 'Ð' | 'Ď' | 'Đ' => out.push('d'),
            'é' | 'è' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' | 'É' | 'È' | 'Ê' | 'Ë'
            | 'Ē' | 'Ĕ' | 'Ė' | 'Ę' | 'Ě' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' | 'ī' | 'ĭ' | 'į' | 'İ' | 'Í' | 'Ì' | 'Î' | 'Ï' | 'Ī'
            | 'Ĭ' | 'Į' => out.push('i'),
            'ñ' | 'ń' | 'ň' | 'Ñ' | 'Ń' | 'Ň' => out.push('n'),
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ø' | 'ō' | 'ŏ' | 'ő' | 'Ó' | 'Ò' | 'Ô' | 'Ö'
            | 'Õ' | 'Ø' | 'Ō' | 'Ŏ' | 'Ő' => out.push('o'),
            'œ' | 'Œ' => out.push_str("oe"),
            'ŕ' | 'ř' | 'Ŕ' | 'Ř' => out.push('r'),
            'ś' | 'š' | 'ş' | 'ŝ' | 'Ś' | 'Š' | 'Ş' | 'Ŝ' => out.push('s'),
            'ß' => out.push_str("ss"),
            'ť' | 'ţ' | 'Ť' | 'Ţ' => out.push('t'),
            'ú' | 'ù' | 'û' | 'ü' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' | 'Ú' | 'Ù' | 'Û' | 'Ü'
            | 'Ū' | 'Ŭ' | 'Ů' | 'Ű' | 'Ų' => out.push('u'),
            'ý' | 'ÿ' | 'ŷ' | 'Ý' | 'Ÿ' | 'Ŷ' => out.push('y'),
            'ž' | 'ź' | 'ż' | 'Ž' | 'Ź' | 'Ż' => out.push('z'),
            _ => out.push(ch),
        }
    }
    out
}

pub(crate) fn normalize_text(value: &str) -> String {
    let lower = canonicalize_stylized_text(value).trim().to_lowercase();
    let spaced = NON_ALNUM_RE.replace_all(&lower, " ");
    MULTISPACE_RE.replace_all(&spaced, " ").trim().to_string()
}

pub(crate) fn normalize_compact(value: &str) -> String {
    normalize_text(value).replace(' ', "")
}

pub(crate) fn identity_tokens(value: &str) -> Vec<String> {
    normalize_text(value)
        .split_whitespace()
        .filter(|part| !matches!(*part, "the" | "and" | "of"))
        .map(|part| part.to_string())
        .collect()
}

pub(crate) fn has_ordered_identity_tokens(value: &str, artist_name: &str) -> bool {
    let artist_tokens = identity_tokens(artist_name);
    if artist_tokens.len() < 2 {
        return false;
    }

    let value_tokens = identity_tokens(value);
    if value_tokens.is_empty() {
        return false;
    }

    let mut cursor = 0usize;
    for token in value_tokens {
        if token == artist_tokens[cursor] {
            cursor += 1;
            if cursor == artist_tokens.len() {
                return true;
            }
        }
    }
    false
}

pub(crate) fn identity_contains(value: &str, artist_name: &str) -> bool {
    let normalized_value = normalize_text(value);
    let normalized_artist = normalize_text(artist_name);
    if normalized_artist.is_empty() {
        return false;
    }
    if normalized_value.contains(&normalized_artist) {
        return true;
    }

    let compact_value = normalize_compact(value);
    let compact_artist = normalize_compact(artist_name);
    (!compact_artist.is_empty() && compact_value.contains(&compact_artist))
        || has_ordered_identity_tokens(value, artist_name)
}

pub(crate) fn count_words(value: &str) -> usize {
    value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .count()
}

pub(crate) fn is_disambiguation_text(value: &str) -> bool {
    let text = normalize_text(value);
    text.contains("may refer to") || text.contains("can refer to")
}

pub(crate) fn is_music_related_text(value: &str) -> bool {
    let text = normalize_text(value);
    let keywords = [
        "band",
        "musician",
        "singer",
        "rapper",
        "dj",
        "disc jockey",
        "group",
        "music",
        "album",
        "song",
        "record",
        "producer",
        "composer",
        "songwriter",
        "lyricist",
        "vocalist",
        "guitarist",
        "pianist",
        "drummer",
        "bassist",
        "violinist",
        "instrumentalist",
        "orchestra",
        "conductor",
        "performer",
        "playback",
        "beatmaker",
        "duo",
        "trio",
        "quartet",
        "artist",
    ];
    keywords.iter().any(|keyword| text.contains(keyword))
}

pub(crate) fn is_likely_artist_title(title: &str, artist_name: &str) -> bool {
    let normalized_title = normalize_text(title);
    let normalized_artist = normalize_text(artist_name);
    let compact_title = normalize_compact(title);
    let compact_artist = normalize_compact(artist_name);

    normalized_title == normalized_artist
        || normalized_title.starts_with(&format!("{normalized_artist} "))
        || normalized_title.ends_with(&format!(" {normalized_artist}"))
        || (!compact_artist.is_empty()
            && (compact_title == compact_artist
                || compact_title.starts_with(&compact_artist)
                || compact_title.ends_with(&compact_artist)))
}

pub(crate) fn is_non_artist_page_title(title: &str) -> bool {
    let normalized_title = normalize_text(title);
    [
        "discography",
        "songs",
        "albums",
        "awards",
        "tour",
        "concert",
        "filmography",
        "production discography",
        " song",
    ]
    .iter()
    .any(|term| normalized_title.contains(term))
}

pub(crate) fn artist_identity_matches(title: &str, summary: &str, source_url: Option<&str>, artist_name: &str) -> bool {
    let normalized_artist = normalize_text(artist_name);
    if normalized_artist.is_empty() {
        return false;
    }

    if is_non_artist_page_title(title) {
        return false;
    }

    let title_matches = is_likely_artist_title(title, artist_name);
    let summary_matches = identity_contains(summary, artist_name);
    if title_matches && summary_matches {
        return true;
    }

    if summary_matches && is_music_related_text(summary) {
        return true;
    }

    source_url
        .map(|url| identity_contains(url, artist_name))
        .unwrap_or(false)
        && summary_matches
}

pub(crate) fn to_word_range(value: &str, min_words: usize, max_words: usize) -> String {
    let words: Vec<&str> = value.split_whitespace().filter(|part| !part.is_empty()).collect();
    if words.is_empty() {
        return String::new();
    }
    if words.len() > max_words {
        return format!("{}...", words[..max_words].join(" "));
    }
    if words.len() < min_words {
        return words.join(" ");
    }
    words.join(" ")
}

pub(crate) fn to_base36(value: i64) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let alphabet = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut buf = Vec::new();
    let mut num = value.abs();
    while num > 0 {
        let idx = (num % 36) as usize;
        buf.push(alphabet[idx] as char);
        num /= 36;
    }
    buf.iter().rev().collect()
}

pub(crate) fn hash_string(value: &str) -> String {
    let mut hash: i64 = 5381;
    for ch in value.chars() {
        hash = ((hash << 5) + hash) ^ (ch as i64);
    }
    to_base36(hash.abs())
}

pub(crate) fn normalize_track_title(value: &str) -> String {
    let lower = value.to_lowercase();
    let stripped = FEAT_RE.replace_all(&lower, "");
    let stripped = stripped.replace(" - ", " ");
    let stripped = PARENS_RE.replace_all(&stripped, " ");
    let stripped = TRACK_CLEAN_RE.replace_all(&stripped, " ");
    let stripped = NON_ALNUM_RE.replace_all(&stripped, " ");
    MULTISPACE_RE.replace_all(&stripped, " ").trim().to_string()
}

pub(crate) fn normalize_plain_lyrics(raw: &str) -> String {
    raw.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn normalize_match_name(value: &str) -> String {
    value.trim().to_lowercase()
}

pub(crate) fn safe_includes(haystack: &str, needle: &str) -> bool {
    normalize_match_name(haystack).contains(&normalize_match_name(needle))
}

pub(crate) fn normalize_artist(value: &str) -> String {
    let stripped = PARENS_RE.replace_all(value, " ");
    let stripped = FEAT_RE.replace_all(&stripped, " ");
    let stripped = stripped
        .replace(['&', '+'], ",")
        .replace("×", ",")
        .replace(" x ", ",")
        .replace(" & ", ",");
    normalize_text(&stripped)
}

pub(crate) fn split_artists(value: &str) -> Vec<String> {
    let stripped = PARENS_RE.replace_all(value, " ");
    let stripped = FEAT_RE.replace_all(&stripped, " ");
    let stripped = stripped
        .replace(['&', '+'], ",")
        .replace("×", ",")
        .replace(" x ", ",")
        .replace(" & ", ",");
    stripped
        .split(',')
        .map(normalize_text)
        .filter(|part| !part.is_empty())
        .collect()
}

pub(crate) fn normalize_title(value: &str) -> String {
    let cleaned = PARENS_RE.replace_all(value, " ");
    let cleaned = cleaned.split(" - ").next().unwrap_or("").trim();
    normalize_text(cleaned)
}

pub(crate) fn is_unknown_album(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    normalized.is_empty()
        || normalized == "unknown album"
        || normalized == "unknown"
        || normalized == "n/a"
        || normalized == "na"
        || normalized == "none"
        || normalized == "unspecified"
        || normalized == "single"
}

pub(crate) fn split_artist_title_hint(value: &str) -> Option<(String, String)> {
    let separators = [" - ", " — ", " – ", " | ", " -- "];
    for sep in separators {
        if let Some((left, right)) = value.split_once(sep) {
            let artist = left.trim();
            let title = right.trim();
            if !artist.is_empty() && !title.is_empty() {
                return Some((artist.to_string(), title.to_string()));
            }
        }
    }
    None
}

pub(crate) fn clean_lyrics_title(raw: &str, artist_hint: Option<&str>) -> String {
    let mut title = raw.to_string();
    if let Some((left, right)) = split_artist_title_hint(&title) {
        if let Some(artist) = artist_hint {
            if normalize_artist(&left) == normalize_artist(artist) {
                title = right;
            }
        }
    }
    let lowered = title.to_lowercase();
    let cut = [" feat.", " ft.", " featuring ", " prod.", " produced by "]
        .iter()
        .filter_map(|token| lowered.find(token))
        .min();
    if let Some(idx) = cut {
        title = title[..idx].to_string();
    }
    let noise = [
        "official", "audio", "video", "lyrics", "lyric", "visualizer", "hq", "hd",
        "high quality", "remaster", "remastered", "instrumental", "acapella",
        "slowed", "reverb", "speed up", "sped up", "clean", "explicit",
        "vocals", "orchestral", "intro", "outro", "thefloridaman",
    ];
    let lowered = title.to_lowercase();
    if let Some(pos) = noise.iter().filter_map(|token| lowered.find(token)).min() {
        title = title[..pos].to_string();
    }
    let stripped = PARENS_RE.replace_all(&title, " ");
    let stripped = TRACK_CLEAN_RE.replace_all(&stripped, " ");
    normalize_part(&stripped)
}

pub(crate) fn is_close_match(candidate: &str, target: &str) -> bool {
    let left = normalize_title(candidate);
    let right = normalize_title(target);
    if left.is_empty() || right.is_empty() {
        return false;
    }
    if left == right {
        return true;
    }
    if left.len() < 3 || right.len() < 3 {
        return false;
    }
    left.contains(&right) || right.contains(&left)
}

pub(crate) fn is_exact_match(candidate: &str, target: &str) -> bool {
    normalize_title(candidate) == normalize_title(target)
}

pub(crate) fn is_artist_close_match(candidate: &str, target: &str) -> bool {
    let left_parts = split_artists(candidate);
    let right_parts = split_artists(target);
    if left_parts.is_empty() || right_parts.is_empty() {
        return false;
    }
    for left in &left_parts {
        for right in &right_parts {
            if left == right {
                return true;
            }
            if left.len() >= 3 && right.len() >= 3 && (left.contains(right) || right.contains(left)) {
                return true;
            }
        }
    }
    false
}

pub(crate) fn normalize_whitespace(value: &str) -> String {
    MULTISPACE_RE.replace_all(value, " ").trim().to_string()
}

pub(crate) fn normalize_part(value: &str) -> String {
    normalize_whitespace(value.trim_matches(|c: char| ",.;/|- ".contains(c)))
}

pub(crate) fn split_simple_and(value: &str) -> Vec<String> {
    let lower = value.to_lowercase();
    if !lower.contains(" and ") {
        return vec![value.to_string()];
    }
    let parts: Vec<String> = value
        .split(" and ")
        .map(normalize_part)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() != 2 {
        return vec![value.to_string()];
    }

    let left_words = parts[0].split_whitespace().count();
    let right_words = parts[1].split_whitespace().count();
    let right_starts_with_the = parts[1].to_lowercase().starts_with("the ");
    let left_lower = parts[0].to_lowercase();
    let right_lower = parts[1].to_lowercase();

    if left_words == 1
        && right_words == 1
        && !right_starts_with_the
        && left_lower != "of"
        && right_lower != "of"
    {
        return parts;
    }
    vec![value.to_string()]
}

pub(crate) fn split_artist_names(artist: &str) -> Vec<String> {
    let raw = normalize_whitespace(artist);
    if raw.is_empty() {
        return vec!["Unknown Artist".to_string()];
    }
    let normalized = raw
        .replace("feat.", ",")
        .replace("featuring", ",")
        .replace("ft.", ",")
        .replace(" with ", ",")
        .replace('+', ",")
        .replace("×", ",")
        .replace(" x ", ",")
        .replace(['&', ';', '/', '|'], ",");
    let mut parts: Vec<String> = Vec::new();
    for part in normalized.split(',') {
        for piece in split_simple_and(part) {
            let cleaned = normalize_part(&piece);
            if !cleaned.is_empty() {
                parts.push(cleaned);
            }
        }
    }
    if parts.is_empty() {
        return vec![raw];
    }
    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for part in parts {
        let key = part.to_lowercase();
        if seen.insert(key) {
            unique.push(part);
        }
    }
    if unique.is_empty() {
        vec![raw]
    } else {
        unique
    }
}

pub(crate) fn get_primary_artist_name(artist: &str) -> String {
    split_artist_names(artist).first().cloned().unwrap_or_else(|| "Unknown Artist".to_string())
}

pub(crate) fn is_low_confidence_artist_name(artist: &str) -> bool {
    let normalized = normalize_text(artist);
    if normalized.is_empty() || normalized == "unknown artist" {
        return true;
    }
    let compact = normalized.replace(' ', "");
    let noisy_terms = [
        "topic",
        "vevo",
        "official",
        "channel",
        "records",
        "recordings",
        "music",
        "thefloridaman",
        "youtube",
        "lyrics",
        "archive",
    ];
    noisy_terms.iter().any(|term| compact.contains(term))
}

/// The artist to look metadata up under. A real artist tag always wins; the "Artist - Title"
/// pattern in the title only fills in when the tag is missing or junk (uploader names, "Topic"
/// channels). Titles like "Blackbird - 2018 Mix" must never turn the song into artist "Blackbird".
pub(crate) fn metadata_artist_for_song(song: &SongInput) -> String {
    let primary_artist = get_primary_artist_name(&song.artist);
    if !is_low_confidence_artist_name(&primary_artist) {
        return primary_artist;
    }
    if let Some((parsed_artist, parsed_title)) = split_artist_title_hint(&song.title) {
        let cleaned_artist = normalize_whitespace(&parsed_artist);
        let cleaned_title = normalize_whitespace(&parsed_title);
        if !cleaned_artist.is_empty() && !cleaned_title.is_empty() {
            return cleaned_artist;
        }
    }
    primary_artist
}

pub(crate) fn is_unknown_genre(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    normalized.is_empty()
        || normalized == "unknown genre"
        || normalized == "unknown"
        || normalized == "n/a"
        || normalized == "na"
        || normalized == "none"
        || normalized == "unspecified"
        || normalized == "various"
        || normalized == "other"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(artist: &str, title: &str) -> SongInput {
        SongInput {
            id: Some("1".to_string()),
            title: title.to_string(),
            artist: artist.to_string(),
            album: None,
            duration: None,
            genre: None,
        }
    }

    #[test]
    fn tagged_artist_wins_over_title_hint() {
        assert_eq!(metadata_artist_for_song(&song("The Beatles", "Blackbird - 2018 Mix")), "The Beatles");
        assert_eq!(metadata_artist_for_song(&song("Radiohead", "Nude - Live")), "Radiohead");
    }

    #[test]
    fn title_hint_fills_in_missing_or_junk_artist() {
        assert_eq!(metadata_artist_for_song(&song("Unknown Artist", "Daft Punk - Around the World")), "Daft Punk");
        assert_eq!(metadata_artist_for_song(&song("", "Daft Punk - Around the World")), "Daft Punk");
        assert_eq!(metadata_artist_for_song(&song("Some Channel - Topic", "Daft Punk - Around the World")), "Daft Punk");
    }

    #[test]
    fn artist_match_handles_apostrophe_variants() {
        assert!(is_artist_close_match("Guns N' Roses", "Guns N Roses"));
        assert!(is_artist_close_match("Guns N’ Roses", "Guns N' Roses"));
    }

    #[test]
    fn artist_identity_handles_stylized_dollar_names() {
        assert!(identity_contains(
            "ASAP Rocky is an American rapper.",
            "A$AP Rocky"
        ));
        assert!(identity_contains("A$AP Rocky", "ASAP Rocky"));
        assert!(identity_contains("Pink is an American singer.", "P!nk"));
        assert!(identity_contains("Kesha is an American singer.", "Ke$ha"));
        assert!(identity_contains("Anderson Paak is an American rapper.", "Anderson .Paak"));
        assert!(identity_contains("Motley Crue is an American rock band.", "Mötley Crüe"));
    }

    #[test]
    fn artist_identity_accepts_birth_name_inserted_between_tokens() {
        let summary = "Ye, born Kanye Omari West, is an American rapper, singer, songwriter, and record producer.";
        assert!(identity_contains(summary, "Kanye West"));
        assert!(artist_identity_matches("Ye", summary, Some("https://en.wikipedia.org/wiki/Ye"), "Kanye West"));
    }

    #[test]
    fn artist_identity_rejects_song_pages() {
        let summary = "Runaway is a song by American rapper Kanye West from his fifth studio album.";
        assert!(!artist_identity_matches(
            "Runaway (Kanye West song)",
            summary,
            Some("https://en.wikipedia.org/wiki/Runaway_(Kanye_West_song)"),
            "Kanye West"
        ));
    }
}
