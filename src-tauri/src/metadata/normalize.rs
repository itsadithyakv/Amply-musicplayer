use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;

use super::SongInput;

static FEAT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bfeat\.?\b|\bft\.?\b|\bfeaturing\b").unwrap());
static PARENS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*[\(\[].*?[\)\]]").unwrap());
/// Everything that is not a letter, digit or combining mark in any script. Marks are kept because
/// Indic vowel signs are combining marks: dropping them would shred Hindi, Tamil and Malayalam.
static NON_ALNUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}\p{M}]+").unwrap());
static MULTISPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static TRACK_CLEAN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(remaster(ed)?|mono|stereo|bonus track|explicit|clean)\b").unwrap());

pub(crate) fn slugify(value: &str) -> String {
    let canonical = canonicalize_stylized_text(value).trim().to_lowercase();
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in canonical.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let slug = out.trim_matches('-').to_string();
    // Scripts an ASCII slug cannot spell (Devanagari, Malayalam, CJK, 'ł', ...) would otherwise
    // vanish, so every such title or artist shared one cache key. A hash of the text keeps them apart.
    if canonical.chars().any(|ch| ch.is_alphanumeric() && !ch.is_ascii()) {
        let suffix = hash_string(&canonical);
        return if slug.is_empty() { suffix } else { format!("{slug}-{suffix}") };
    }
    slug
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

/// Whether two credits name the same act. Case, accents, stylised letters, punctuation, spacing and
/// a leading "The" are ignored ("JAŸ-Z" = "Jay-Z", "The Weeknd" = "Weeknd", "A$AP" = "ASAP");
/// nothing else is, so "Drake" is not "Drake Bell" and "Future" is not "Future Islands".
pub(crate) fn same_artist_name(left: &str, right: &str) -> bool {
    let key = |value: &str| {
        let normalized = normalize_text(value);
        normalized.strip_prefix("the ").unwrap_or(&normalized).replace(' ', "")
    };
    let left = key(left);
    !left.is_empty() && left == key(right)
}

/// A Wikipedia page title without its disambiguating suffix: "Berlin (band)" -> "Berlin".
pub(crate) fn page_title_core(title: &str) -> &str {
    let trimmed = title.trim();
    match trimmed.rfind(" (") {
        Some(index) if trimmed.ends_with(')') => trimmed[..index].trim(),
        _ => trimmed,
    }
}

/// The page title in an English Wikipedia article URL: ".../wiki/Tyler%2C_the_Creator" ->
/// "Tyler, the Creator". None for anything that is not an en.wikipedia.org article.
pub(crate) fn wikipedia_title_from_url(url: &str) -> Option<String> {
    let path = url
        .strip_prefix("https://en.wikipedia.org/wiki/")
        .or_else(|| url.strip_prefix("http://en.wikipedia.org/wiki/"))?;
    let path = path.split(['#', '?']).next().unwrap_or("");
    let decoded = percent_decode(path)?.replace('_', " ");
    let title = decoded.trim();
    (!title.is_empty()).then(|| title.to_string())
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// What a Wikipedia page is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PageKind {
    /// A musician, band, producer or other act.
    Artist,
    /// A song, album, tour or other work: "Planet Caravan is a song by Black Sabbath".
    Work,
    /// A list, discography or awards page.
    List,
    Disambiguation,
    /// Anything else: a city, a person known for something other than music, a brand.
    Other,
}

/// Role nouns that make the subject of a lead sentence an act.
const ACT_NOUNS: &[&str] = &[
    "band", "group", "duo", "trio", "quartet", "quintet", "ensemble", "orchestra", "choir", "collective",
    "project", "supergroup", "musician", "singer", "rapper", "songwriter", "vocalist", "producer", "dj",
    "composer", "lyricist", "guitarist", "pianist", "drummer", "bassist", "violinist", "keyboardist",
    "saxophonist", "trumpeter", "cellist", "instrumentalist", "conductor", "artist", "mc", "emcee",
    "beatmaker", "performer", "entertainer",
];

/// Nouns that make the subject of a lead sentence a work or an event rather than an act.
const WORK_NOUNS: &[&str] = &[
    "song", "single", "album", "ep", "mixtape", "soundtrack", "track", "ballad", "anthem", "hymn", "tour",
    "concert", "festival", "film", "series", "episode", "novel", "game", "discography", "list",
];

/// Classifies a page from its title and opening text. The lead sentence decides: the first role
/// noun after "is a" / "were an" / "is the" names what the subject is, so "Kanye West ... is an
/// American rapper" is an act while "Runaway is a song by American rapper Kanye West" is a work.
pub(crate) fn classify_wikipedia_page(title: &str, lead: &str) -> PageKind {
    if is_disambiguation_text(lead) {
        return PageKind::Disambiguation;
    }
    let normalized_title = normalize_text(title);
    if normalized_title.starts_with("list of")
        || ["discography", "filmography", "videography", "awards and nominations", "concert tours"]
            .iter()
            .any(|term| normalized_title.contains(term))
    {
        return PageKind::List;
    }
    let normalized_lead = normalize_text(lead);
    let words: Vec<&str> = normalized_lead.split_whitespace().collect();
    let Some(copula) = words.windows(2).position(|pair| {
        matches!(pair[0], "is" | "was" | "are" | "were") && matches!(pair[1], "a" | "an" | "the")
    }) else {
        return PageKind::Other;
    };
    for word in words.iter().skip(copula + 2).take(16) {
        if ACT_NOUNS.contains(word) {
            return PageKind::Artist;
        }
        if WORK_NOUNS.contains(word) {
            return if *word == "list" || *word == "discography" { PageKind::List } else { PageKind::Work };
        }
    }
    PageKind::Other
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

/// A bracketed group with no brackets inside it: "(Official Audio)", "[HD]", "{Remix}".
static BRACKET_GROUP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*[\(\[\{]([^\(\)\[\]\{\}]*)[\)\]\}]").unwrap());
/// Inline credit at the end of a title: "Song feat. X", "Song ft X", "Song featuring X".
static INLINE_FEAT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s+(feat\.?|ft\.?|featuring)\s+.*$").unwrap());
/// Markers that make a whole segment upload junk wherever they appear in it.
static UPLOAD_NOISE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(official|visuali[sz]er|lyrics?\s+video|music\s+video|free\s+(dl|download)|out\s+now|prod(\.|uced)?\b|high\s+quality|thefloridaman)")
        .unwrap()
});
/// Words that are junk only when they are the entire segment: "(Clean)", "[HD]", "- Lyrics".
static UPLOAD_NOISE_ALONE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(clean|explicit|dirty|audio|video|hd|hq|4k|lyrics?|full\s+(song|version))$").unwrap()
});
/// Version qualifiers: the same song in another cut. Mirrors `isVersionQualifier` in src/utils/titles.ts.
static VERSION_QUALIFIER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^((19|20)\d{2}|(from|with|feat\.?|ft\.?|featuring)\b.*|.*\b(remaster(ed)?|version|edit(ed)?|mix|remix|live|acoustic|demo|instrumental|mono|stereo|bonus\s+track|deluxe|edition|anniversary|single|soundtrack|motion\s+picture|ost|sped\s+up|slowed|reverb|nightcore|8d|session|show|take\s+\d+)\b.*)$",
    )
    .unwrap()
});

/// Whether a bracketed group or " - " suffix is upload junk ("Official Audio", "prod. X", "HD").
pub(crate) fn is_upload_noise(segment: &str) -> bool {
    let segment = segment.trim();
    !segment.is_empty() && (UPLOAD_NOISE_RE.is_match(segment) || UPLOAD_NOISE_ALONE_RE.is_match(segment))
}

/// Whether a bracketed group or " - " suffix names a version of the song rather than the song:
/// "2009 Remaster", "Radio Edit", "From \"Hridayam\"", "Live", "feat. X". Real parts of a name
/// ("Pt. 2", "Reprise", "Interlude", "Choir Outro", "Backstreet's Back") are not qualifiers.
pub(crate) fn is_version_qualifier(segment: &str) -> bool {
    let segment = segment.trim();
    !segment.is_empty() && VERSION_QUALIFIER_RE.is_match(segment)
}

/// Rightmost " - " style separator: (left, right).
fn rsplit_title_dash(title: &str) -> Option<(&str, &str)> {
    [" - ", " – ", " — ", " | "]
        .iter()
        .filter_map(|sep| title.rfind(sep).map(|index| (index, sep.len())))
        .max_by_key(|(index, _)| *index)
        .map(|(index, len)| (&title[..index], &title[index + len..]))
}

/// Removes bracketed groups anywhere, and trailing " - X" segments, whose content `is_removable`.
/// Segments are judged whole, so a word inside a real title ("29 Intro", "Happy Birthday",
/// "Clean Bandit") is never cut.
pub(crate) fn strip_title_segments(title: &str, is_removable: impl Fn(&str) -> bool) -> String {
    let without_groups = BRACKET_GROUP_RE.replace_all(title, |caps: &regex::Captures| {
        let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        if is_removable(inner) {
            " ".to_string()
        } else {
            caps[0].to_string()
        }
    });
    let mut result = normalize_whitespace(&without_groups);
    while let Some((left, right)) = rsplit_title_dash(&result) {
        if left.trim().is_empty() || !is_removable(right) {
            break;
        }
        result = left.trim().to_string();
    }
    normalize_whitespace(result.trim_end_matches(|c: char| "([{-–—|".contains(c) || c.is_whitespace()))
}

/// Title to look a song up by: artist prefix, upload junk, version qualifiers and credits removed.
/// "Black Sabbath - War Pigs - 2009 Remaster" -> "War Pigs"; "Maangalyam - From \"Bangalore Days\""
/// -> "Maangalyam"; "29 Intro" -> "29 Intro". Falls back to the raw title rather than returning "".
pub(crate) fn clean_lyrics_title(raw: &str, artist_hint: Option<&str>) -> String {
    let mut title = normalize_whitespace(raw);
    if let Some((left, right)) = split_artist_title_hint(&title) {
        let left_key = normalize_artist(&left);
        if !left_key.is_empty() && artist_hint.is_some_and(|artist| normalize_artist(artist) == left_key) {
            title = right;
        }
    }
    let stripped = strip_title_segments(&title, |segment| is_upload_noise(segment) || is_version_qualifier(segment));
    let stripped = INLINE_FEAT_RE.replace(&stripped, "");
    let cleaned = normalize_part(&stripped);
    if cleaned.is_empty() {
        normalize_whitespace(raw)
    } else {
        cleaned
    }
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

/// Whether any act credited in `candidate` is an act credited in `target`. Names are compared
/// whole ("Drake" never matches "Drake Bell"), so a same-titled song by another act is rejected.
pub(crate) fn is_artist_close_match(candidate: &str, target: &str) -> bool {
    let left_parts = split_artists(candidate);
    let right_parts = split_artists(target);
    left_parts
        .iter()
        .any(|left| right_parts.iter().any(|right| same_artist_name(left, right)))
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

/// Acts whose names contain separators. Mirrors KNOWN_GROUP_NAMES in src/utils/artists.ts.
const KNOWN_GROUP_NAMES: &[&str] = &[
    "ac/dc", "simon & garfunkel", "earth, wind & fire", "crosby, stills, nash & young", "crosby, stills & nash",
    "tyler, the creator", "mumford & sons", "hall & oates", "daryl hall & john oates", "blood, sweat & tears",
    "peter, paul and mary", "emerson, lake & palmer", "brooks & dunn", "big & rich", "chase & status",
    "above & beyond", "years & years", "iron & wine", "she & him", "matt & kim", "belle & sebastian",
    "of monsters and men", "sam & dave", "sonny & cher", "ike & tina turner", "tegan and sara",
    "macklemore & ryan lewis", "zach & cody", "black country, new road",
];

/// Replaces a known group name with an indexed placeholder, and hides the separator in
/// "X & The Y" / "X + The Y" acts ("Kool & the Gang", "Florence + The Machine"), so the splitter
/// leaves them whole. `restore_group_names` puts the original text back.
fn protect_group_names(raw: &str) -> (String, Vec<String>) {
    let mut value = raw.to_string();
    let mut saved = Vec::new();
    let lower = value.to_lowercase();
    for name in KNOWN_GROUP_NAMES {
        if let Some(start) = lower.find(name) {
            let end = start + name.len();
            let boundary_ok = lower[..start].chars().last().is_none_or(|c| !c.is_alphanumeric())
                && lower[end..].chars().next().is_none_or(|c| !c.is_alphanumeric());
            if boundary_ok && value.is_char_boundary(start) && value.is_char_boundary(end) {
                saved.push(value[start..end].to_string());
                value.replace_range(start..end, &format!("\u{E000}{}\u{E001}", saved.len() - 1));
                break;
            }
        }
    }
    static AND_THE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s*([&+])\s*(the\s)").unwrap());
    let value = AND_THE_RE
        .replace_all(&value, |caps: &regex::Captures| {
            let sep = if &caps[1] == "&" { '\u{E002}' } else { '\u{E003}' };
            format!(" {sep} {}", &caps[2])
        })
        .into_owned();
    (value, saved)
}

fn restore_group_names(value: &str, saved: &[String]) -> String {
    static PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x{E000}(\d+)\x{E001}").unwrap());
    PLACEHOLDER_RE
        .replace_all(value, |caps: &regex::Captures| {
            caps[1].parse::<usize>().ok().and_then(|index| saved.get(index)).cloned().unwrap_or_default()
        })
        .replace('\u{E002}', "&")
        .replace('\u{E003}', "+")
}

static ARTIST_SEPARATOR_RE: LazyLock<Regex> = LazyLock::new(|| {
    // Case-insensitive credits; "/" only with spaces around it so "AC/DC"-style names survive.
    Regex::new(r"(?i)\s+(feat\.?|featuring|ft\.?|with|x|×)\s+|\s*[&+;|,]\s*|\s+/\s+").unwrap()
});

pub(crate) fn split_artist_names(artist: &str) -> Vec<String> {
    let raw = normalize_whitespace(artist);
    if raw.is_empty() {
        return vec!["Unknown Artist".to_string()];
    }
    let (protected, saved) = protect_group_names(&raw);
    let normalized = ARTIST_SEPARATOR_RE.replace_all(&protected, ",");
    let mut parts: Vec<String> = Vec::new();
    for part in normalized.split(',') {
        // A protected group name is one artist: skip the "A and B" splitter for it.
        if part.contains('\u{E000}') {
            let restored = normalize_part(&restore_group_names(part, &saved));
            if !restored.is_empty() {
                parts.push(restored);
            }
            continue;
        }
        let part = restore_group_names(part, &saved);
        let part = part.as_str();
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
    if artist.trim().is_empty() {
        return true;
    }
    let normalized = normalize_text(artist);
    if normalized.is_empty()
        || matches!(normalized.as_str(), "unknown artist" | "unknown" | "various artists" | "various" | "va" | "soundcloud" | "youtube")
    {
        return true;
    }
    // Upload handles and channel names, matched as whole words or suffixes so real artists that
    // merely contain the letters ("Musical Youth", "Channel Tres" aside) are not flagged.
    let words: Vec<&str> = normalized.split_whitespace().collect();
    let compact = normalized.replace(' ', "");
    if words.first() == Some(&"user") && words.get(1).is_some_and(|word| word.chars().all(|c| c.is_ascii_digit())) {
        return true;
    }
    if words.iter().any(|word| matches!(*word, "topic" | "vevo" | "records" | "recordings" | "youtube" | "lyrics" | "thefloridaman" | "uploads"))
        || compact.ends_with("vevo")
        || compact.ends_with("topic")
        || (words.len() > 1 && words.last() == Some(&"music") && words.first() != Some(&"the"))
        || (words.len() > 1 && words.last() == Some(&"official"))
        || (words.len() > 1 && words.last() == Some(&"channel"))
    {
        return true;
    }
    false
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
        // "War Pigs - 2009 Remaster": the right side is a version, so the left side is the title.
        if is_version_qualifier(&parsed_title) || is_upload_noise(&parsed_title) {
            return primary_artist;
        }
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
            path: None,
            id: Some("1".to_string()),
            title: title.to_string(),
            artist: artist.to_string(),
            album: None,
            duration: None,
            genre: None,
        }
    }

    #[test]
    fn lookup_titles_drop_versions_and_junk_but_keep_real_names() {
        let clean = |title: &str| clean_lyrics_title(title, Some("Black Sabbath"));
        assert_eq!(clean("War Pigs - 2009 Remaster"), "War Pigs");
        assert_eq!(clean("Iron Man (2012 Remaster)"), "Iron Man");
        assert_eq!(clean("Black Sabbath - Paranoid - 2009 Remaster"), "Paranoid");
        assert_eq!(clean("Take Me Home, Country Roads (Original Version) [Remastered]"), "Take Me Home, Country Roads");
        assert_eq!(clean("Many Men (Wish Death) - Album Version (Edited)"), "Many Men (Wish Death)");
        assert_eq!(clean("Maangalyam - From \"Bangalore Days\""), "Maangalyam");
        assert_eq!(clean("Around the World (Official Audio)"), "Around the World");
        assert_eq!(clean("Song [HD] (prod. Metro Boomin)"), "Song");
        assert_eq!(clean("Mmm Yeah - feat. Pitbull"), "Mmm Yeah");
        assert_eq!(clean("Chase Me (feat. Run The Jewels & Big Boi) - Single Version - Music From The Motion Picture Baby Driver"), "Chase Me");
        // Words inside real titles are never cut.
        assert_eq!(clean("Hold On - Remix"), "Hold On");
        assert_eq!(clean("Sweet Child O' Mine (Live at the Ritz)"), "Sweet Child O' Mine");
        assert_eq!(clean("For Free? - Interlude"), "For Free? - Interlude");
        assert_eq!(clean("29 Intro"), "29 Intro");
        assert_eq!(clean("Happy Birthday"), "Happy Birthday");
        assert_eq!(clean("Cleanin' Out My Closet"), "Cleanin' Out My Closet");
        assert_eq!(clean("Video Games"), "Video Games");
        assert_eq!(clean("Everybody (Backstreet's Back) - Radio Edit"), "Everybody (Backstreet's Back)");
        assert_eq!(clean("Let Down - Choir Outro"), "Let Down - Choir Outro");
        assert_eq!(clean("Father Stretch My Hands (Pt. 1)"), "Father Stretch My Hands (Pt. 1)");
    }

    #[test]
    fn version_suffix_is_not_an_artist_title_split() {
        assert_eq!(metadata_artist_for_song(&song("Unknown Artist", "War Pigs - 2009 Remaster")), "Unknown Artist");
        assert_eq!(metadata_artist_for_song(&song("Unknown Artist", "Daft Punk - Around the World")), "Daft Punk");
    }

    #[test]
    fn non_latin_text_survives_normalisation_and_slugs_stay_distinct() {
        assert!(!normalize_text("दिल तू जान तू").is_empty());
        assert!(!is_low_confidence_artist_name("ഗോപി സുന്ദർ"));
        assert_ne!(slugify("காதல்"), slugify("प्यार"));
        assert!(!slugify("காதல்").is_empty());
        assert_eq!(slugify("Beyoncé"), "beyonce");
        assert_eq!(slugify("JAŸ-Z"), "jay-z");
    }

    #[test]
    fn group_names_are_not_split() {
        assert_eq!(get_primary_artist_name("AC/DC"), "AC/DC");
        assert_eq!(get_primary_artist_name("Earth, Wind & Fire"), "Earth, Wind & Fire");
        assert_eq!(get_primary_artist_name("Tyler, The Creator, Kali Uchis"), "Tyler, The Creator");
        assert_eq!(get_primary_artist_name("Kool & the Gang"), "Kool & the Gang");
        assert_eq!(split_artist_names("Metro Boomin, The Weeknd, 21 Savage").len(), 3);
        assert_eq!(split_artist_names("Artist Feat. Guest"), vec!["Artist".to_string(), "Guest".to_string()]);
        assert_eq!(split_artist_names("A / B").len(), 2);
        assert_eq!(get_primary_artist_name("Tegan and Sara"), "Tegan and Sara");
    }

    #[test]
    fn low_confidence_artists_use_whole_words() {
        assert!(is_low_confidence_artist_name("TaylorSwiftVEVO"));
        assert!(is_low_confidence_artist_name("Skrillex - Topic"));
        assert!(is_low_confidence_artist_name("xyz music"));
        assert!(is_low_confidence_artist_name("user-482910337"));
        assert!(!is_low_confidence_artist_name("Musical Youth"));
        assert!(!is_low_confidence_artist_name("The Music"));
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
    fn artist_names_compare_whole_not_by_substring() {
        assert!(same_artist_name("JAŸ-Z", "Jay-Z"));
        assert!(same_artist_name("The Weeknd", "Weeknd"));
        assert!(same_artist_name("A$AP Rocky", "ASAP Rocky"));
        assert!(same_artist_name("*NSYNC", "NSYNC"));
        assert!(same_artist_name("Tyler, The Creator", "Tyler, the Creator"));
        assert!(!same_artist_name("Drake", "Drake Bell"));
        assert!(!same_artist_name("Future", "Future Islands"));
        assert!(!same_artist_name("", ""));
        assert!(!is_artist_close_match("Drake Bell", "Drake"));
        assert!(is_artist_close_match("50 Cent, Olivia", "Olivia"));
    }

    #[test]
    fn page_titles_come_apart_from_urls_and_qualifiers() {
        assert_eq!(page_title_core("Berlin (band)"), "Berlin");
        assert_eq!(page_title_core("Tyler, the Creator"), "Tyler, the Creator");
        assert_eq!(page_title_core("Many Men (Wish Death)"), "Many Men");
        assert_eq!(
            wikipedia_title_from_url("https://en.wikipedia.org/wiki/Tyler%2C_the_Creator").as_deref(),
            Some("Tyler, the Creator")
        );
        assert_eq!(wikipedia_title_from_url("https://en.wikipedia.org/wiki/Beyonc%C3%A9").as_deref(), Some("Beyoncé"));
        assert_eq!(wikipedia_title_from_url("https://de.wikipedia.org/wiki/Bellini"), None);
    }

    #[test]
    fn lead_sentence_tells_acts_from_songs_lists_and_places() {
        let kind = |title: &str, lead: &str| classify_wikipedia_page(title, lead);
        // Real leads from the app's cache.
        assert_eq!(kind("Kanye West", "Ye ( YAY; born Kanye Omari West, June 8, 1977) is an American rapper, songwriter, record producer."), PageKind::Artist);
        assert_eq!(kind("Tame Impala", "Tame Impala is the psychedelic music project of Australian singer Kevin Parker."), PageKind::Artist);
        assert_eq!(kind("ABBA", "ABBA ( AB-ə [ˈâbːa]) (often stylised as ABBA) were a Swedish pop music group formed in Stockholm."), PageKind::Artist);
        assert_eq!(kind("C418", "Daniel Rosenfeld, known professionally as C418, is a German musician, composer, producer."), PageKind::Artist);
        assert_eq!(kind("Planet Caravan", "\"Planet Caravan\" is a song by the English heavy metal band Black Sabbath."), PageKind::Work);
        assert_eq!(kind("Many Men (Wish Death)", "\"Many Men (Wish Death)\" is a song by American rapper 50 Cent."), PageKind::Work);
        assert_eq!(kind("Paranoid (album)", "Paranoid is the second studio album by English rock band Black Sabbath."), PageKind::Work);
        assert_eq!(kind("List of Billy Joel band members", "Billy Joel is an American singer-songwriter and pianist who has used various musicians."), PageKind::List);
        assert_eq!(kind("Berlin", "Berlin is the capital and largest city of Germany."), PageKind::Other);
        assert_eq!(kind("Spectrum", "Spectrum may refer to:"), PageKind::Disambiguation);
    }
}
