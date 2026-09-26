//! Who an artist name refers to. A bare name is ambiguous ("Berlin" is a city and a band,
//! "Bellini" is an opera composer, an Italian math-rock band and a German dance trio), so the songs
//! the library holds under that name pick the act out:
//!
//! 1. MusicBrainz matches one of those songs (or albums) to an artist id.
//! 2. That artist's Wikidata link names its exact English Wikipedia page.
//! 3. Only when MusicBrainz cannot answer does a Wikipedia search run, and a page it finds must be
//!    about an act with this exact name, and is preferred when it mentions the library's songs.

use std::collections::HashMap;

use reqwest::Url;
use serde::Deserialize;

use super::artist::{fetch_wikipedia_search_titles_for_query, fetch_wikipedia_summary, WikipediaSummaryPayload};
use super::http::{fetch_json, is_offline_error, musicbrainz_throttle};
use super::normalize::{
    classify_wikipedia_page, clean_lyrics_title, is_close_match, is_unknown_album, normalize_text,
    page_title_core, same_artist_name, wikipedia_title_from_url, PageKind,
};
use super::ArtistContext;

/// Bumped when the rules for accepting a page change, so older cache entries get re-checked.
pub(crate) const RESOLVER_VERSION: u32 = 2;

const MAX_CONTEXT_TITLES: usize = 3;
const MAX_CONTEXT_ALBUMS: usize = 2;
/// MusicBrainz allows one request a second, so recording probes stop after this many titles.
const MAX_RECORDING_PROBES: usize = 2;
const MAX_FALLBACK_PAGES: usize = 6;

/// What MusicBrainz knows about the act behind a name.
#[derive(Debug, Default)]
pub(crate) struct MbIdentity {
    /// The artist the library's songs belong to, when one was pinned down.
    pub mbid: Option<String>,
    /// That artist's English Wikipedia page, from its Wikidata or Wikipedia link.
    pub wikipedia_title: Option<String>,
    /// How many MusicBrainz artists carry exactly this name; filled only when no song or album
    /// picked one out, so a count above 1 means the name alone is ambiguous.
    pub namesakes: usize,
}

/// A Wikipedia page accepted as the artist's.
pub(crate) struct ResolvedArtistPage {
    pub title: String,
    pub summary: WikipediaSummaryPayload,
    pub mbid: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// Context

/// Lookup-ready song titles and album names from the context: versions, junk and the artist's own
/// name removed, duplicates and placeholders dropped.
fn context_terms(artist_name: &str, context: &ArtistContext) -> (Vec<String>, Vec<String>) {
    let mut seen = Vec::<String>::new();
    let mut keep = |value: String, limit: usize, out: &mut Vec<String>| {
        let key = normalize_text(&value);
        if out.len() < limit
            && key.chars().count() >= 2
            && key != "unknown title"
            && !same_artist_name(&value, artist_name)
            && !seen.contains(&key)
        {
            seen.push(key);
            out.push(value);
        }
    };
    let mut titles = Vec::new();
    for title in &context.titles {
        keep(clean_lyrics_title(title, Some(artist_name)), MAX_CONTEXT_TITLES, &mut titles);
    }
    let mut albums = Vec::new();
    for album in context.albums.iter().filter(|album| !is_unknown_album(album)) {
        keep(clean_lyrics_title(album, Some(artist_name)), MAX_CONTEXT_ALBUMS, &mut albums);
    }
    (titles, albums)
}

/// Whether `text` names one of the library's songs or albums as a whole phrase.
fn mentions_any(text: &str, terms: &[String]) -> bool {
    let haystack = format!(" {} ", normalize_text(text));
    terms.iter().any(|term| {
        let needle = normalize_text(term);
        needle.chars().count() >= 4 && haystack.contains(&format!(" {needle} "))
    })
}

// ---------------------------------------------------------------------------------------------
// MusicBrainz

#[derive(Debug, Deserialize)]
struct MbCredit {
    name: Option<String>,
    artist: Option<MbCreditArtist>,
}

#[derive(Debug, Deserialize)]
struct MbCreditArtist {
    id: String,
    name: Option<String>,
}

/// A recording or release hit: both carry a title and an artist credit.
#[derive(Debug, Deserialize)]
struct MbCreditedHit {
    title: Option<String>,
    #[serde(rename = "artist-credit")]
    artist_credit: Option<Vec<MbCredit>>,
}

#[derive(Debug, Deserialize)]
struct MbRecordingSearch {
    recordings: Option<Vec<MbCreditedHit>>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseSearch {
    releases: Option<Vec<MbCreditedHit>>,
}

#[derive(Debug, Deserialize)]
struct MbArtistSearch {
    artists: Option<Vec<MbArtistHit>>,
}

#[derive(Debug, Deserialize)]
struct MbArtistHit {
    id: String,
    name: Option<String>,
    aliases: Option<Vec<MbAlias>>,
}

#[derive(Debug, Deserialize)]
struct MbAlias {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbArtistLookup {
    relations: Option<Vec<MbRelation>>,
}

#[derive(Debug, Deserialize)]
struct MbRelation {
    #[serde(rename = "type")]
    kind: Option<String>,
    url: Option<MbUrl>,
}

#[derive(Debug, Deserialize)]
struct MbUrl {
    resource: Option<String>,
}

/// A Lucene phrase: quotes and backslashes escaped so "12\" Mix" cannot break the query.
fn lucene_phrase(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

async fn musicbrainz_search<T: for<'de> Deserialize<'de>>(entity: &str, query: &str) -> Result<T, String> {
    let url = Url::parse_with_params(
        &format!("https://musicbrainz.org/ws/2/{entity}"),
        &[("query", query), ("fmt", "json"), ("limit", "10")],
    )
    .map_err(|err| err.to_string())?;
    musicbrainz_throttle().await;
    fetch_json(url).await
}

/// Adds a vote for every artist credited under `artist_name` on hits titled `title`. Votes keep
/// first-seen order so ties resolve to MusicBrainz's own best hit.
fn tally_credited_artists(hits: &[MbCreditedHit], artist_name: &str, title: &str, votes: &mut Vec<(String, u32)>) {
    for hit in hits {
        if !hit.title.as_deref().is_some_and(|hit_title| is_close_match(hit_title, title)) {
            continue;
        }
        for credit in hit.artist_credit.iter().flatten() {
            let Some(artist) = credit.artist.as_ref() else {
                continue;
            };
            let named = credit.name.as_deref().is_some_and(|name| same_artist_name(name, artist_name))
                || artist.name.as_deref().is_some_and(|name| same_artist_name(name, artist_name));
            if !named {
                continue;
            }
            match votes.iter_mut().find(|(id, _)| id == &artist.id) {
                Some((_, count)) => *count += 1,
                None => votes.push((artist.id.clone(), 1)),
            }
        }
    }
}

fn best_vote(votes: &[(String, u32)]) -> Option<String> {
    let top = votes.iter().map(|(_, count)| *count).max()?;
    votes.iter().find(|(_, count)| *count == top).map(|(id, _)| id.clone())
}

/// Ids of the artists whose name or an alias is exactly `artist_name`.
fn namesake_ids(hits: &[MbArtistHit], artist_name: &str) -> Vec<String> {
    hits.iter()
        .filter(|hit| {
            hit.name.as_deref().is_some_and(|name| same_artist_name(name, artist_name))
                || hit
                    .aliases
                    .iter()
                    .flatten()
                    .any(|alias| alias.name.as_deref().is_some_and(|name| same_artist_name(name, artist_name)))
        })
        .map(|hit| hit.id.clone())
        .collect()
}

fn is_mbid(value: &str) -> bool {
    value.len() == 36 && value.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-')
}

#[derive(Debug, Deserialize)]
struct WikidataEntities {
    entities: Option<HashMap<String, WikidataEntity>>,
}

#[derive(Debug, Deserialize)]
struct WikidataEntity {
    sitelinks: Option<HashMap<String, WikidataSitelink>>,
}

#[derive(Debug, Deserialize)]
struct WikidataSitelink {
    title: Option<String>,
}

async fn wikidata_enwiki_title(qid: &str) -> Result<Option<String>, String> {
    let url = Url::parse_with_params(
        "https://www.wikidata.org/w/api.php",
        &[("action", "wbgetentities"), ("ids", qid), ("props", "sitelinks"), ("sitefilter", "enwiki"), ("format", "json")],
    )
    .map_err(|err| err.to_string())?;
    let payload: WikidataEntities = fetch_json(url).await?;
    Ok(payload
        .entities
        .and_then(|mut entities| entities.remove(qid))
        .and_then(|entity| entity.sitelinks)
        .and_then(|mut links| links.remove("enwiki"))
        .and_then(|link| link.title)
        .filter(|title| !title.trim().is_empty()))
}

/// The English Wikipedia page MusicBrainz links an artist to: its own Wikipedia relation when it
/// has one, otherwise through Wikidata.
async fn musicbrainz_wikipedia_title(mbid: &str) -> Result<Option<String>, String> {
    if !is_mbid(mbid) {
        return Ok(None);
    }
    let url = Url::parse_with_params(
        &format!("https://musicbrainz.org/ws/2/artist/{mbid}"),
        &[("inc", "url-rels"), ("fmt", "json")],
    )
    .map_err(|err| err.to_string())?;
    musicbrainz_throttle().await;
    let lookup: MbArtistLookup = fetch_json(url).await?;
    let relations = lookup.relations.unwrap_or_default();
    let resource = |kind: &str| {
        relations
            .iter()
            .filter(|relation| relation.kind.as_deref() == Some(kind))
            .filter_map(|relation| relation.url.as_ref()?.resource.clone())
            .collect::<Vec<_>>()
    };
    if let Some(title) = resource("wikipedia").iter().find_map(|url| wikipedia_title_from_url(url)) {
        return Ok(Some(title));
    }
    for url in resource("wikidata") {
        let qid = url.rsplit('/').next().unwrap_or_default();
        if qid.starts_with('Q') && qid[1..].chars().all(|ch| ch.is_ascii_digit()) {
            return wikidata_enwiki_title(qid).await;
        }
    }
    Ok(None)
}

/// Pins the name to one MusicBrainz artist: first by the library's songs, then its albums, then —
/// only if exactly one artist carries the name — by the name alone.
pub(crate) async fn resolve_musicbrainz_identity(
    artist_name: &str,
    context: &ArtistContext,
) -> Result<MbIdentity, String> {
    let (titles, albums) = context_terms(artist_name, context);
    let artist = lucene_phrase(artist_name);
    let mut votes = Vec::new();

    for title in titles.iter().take(MAX_RECORDING_PROBES) {
        let query = format!("recording:{} AND artist:{artist}", lucene_phrase(title));
        let payload: MbRecordingSearch = musicbrainz_search("recording", &query).await?;
        tally_credited_artists(payload.recordings.as_deref().unwrap_or_default(), artist_name, title, &mut votes);
        if !votes.is_empty() {
            break;
        }
    }
    if votes.is_empty() {
        if let Some(album) = albums.first() {
            let query = format!("release:{} AND artist:{artist}", lucene_phrase(album));
            let payload: MbReleaseSearch = musicbrainz_search("release", &query).await?;
            tally_credited_artists(payload.releases.as_deref().unwrap_or_default(), artist_name, album, &mut votes);
        }
    }

    let mut identity = MbIdentity { mbid: best_vote(&votes), ..MbIdentity::default() };
    if identity.mbid.is_none() {
        let payload: MbArtistSearch = musicbrainz_search("artist", &format!("artist:{artist}")).await?;
        let namesakes = namesake_ids(payload.artists.as_deref().unwrap_or_default(), artist_name);
        identity.namesakes = namesakes.len();
        if let [only] = namesakes.as_slice() {
            identity.mbid = Some(only.clone());
        }
    }
    if let Some(mbid) = identity.mbid.as_deref() {
        identity.wikipedia_title = musicbrainz_wikipedia_title(mbid).await?;
    }
    Ok(identity)
}

// ---------------------------------------------------------------------------------------------
// Wikipedia

/// What a fetched summary is about; the REST API's own page type flags disambiguation pages whose
/// text does not say "may refer to".
fn summary_kind(title: &str, summary: &WikipediaSummaryPayload) -> PageKind {
    if summary.page_type.as_deref() == Some("disambiguation") {
        return PageKind::Disambiguation;
    }
    classify_wikipedia_page(title, summary.extract.as_deref().unwrap_or(""))
}

/// Pages whose text mentions the artist together with one of the library's songs or albums.
async fn evidence_search(artist_name: &str, titles: &[String], albums: &[String]) -> Vec<String> {
    let phrases: Vec<String> = titles
        .iter()
        .chain(albums)
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect();
    if phrases.is_empty() {
        return Vec::new();
    }
    let query = format!("\"{}\" ({})", artist_name.replace('"', ""), phrases.join(" OR "));
    match fetch_wikipedia_search_titles_for_query(&query, 8).await {
        Ok(found) => found,
        Err(error) => {
            log::warn!("Wikipedia evidence search for {artist_name:?} failed: {error}");
            Vec::new()
        }
    }
}

/// Whether a page found by searching Wikipedia may stand as the artist's. By the time this runs the
/// page is known to be about an act whose name is exactly `artist_name`; what is left to decide is
/// whether it is the *right* act of that name.
///
/// - `evidence`: the page mentions one of the library's songs or albums by this artist.
/// - `primary_topic`: the page sits at the bare name ("Radiohead", not "Berlin (band)"), so
///   Wikipedia considers it the main thing the name refers to.
/// - `identity`: what MusicBrainz found — `mbid` set with no `wikipedia_title` means MusicBrainz knows
///   the library's act and it has no English page; `namesakes > 1` means the name is shared.
fn accept_fallback_page(evidence: bool, primary_topic: bool, identity: &MbIdentity) -> bool {
    // A page that mentions the library's own songs is about this act, whatever else is true.
    if evidence {
        return true;
    }
    // MusicBrainz knows this act and it has no English page, or several acts share the name: any
    // page found by name alone is most likely a namesake ("Spectrum" the Australian prog band).
    let namesake_risk = (identity.mbid.is_some() && identity.wikipedia_title.is_none()) || identity.namesakes > 1;
    // Otherwise the page Wikipedia files at the bare name is the act most people mean by it.
    primary_topic && !namesake_risk
}

/// Searches Wikipedia for the act when MusicBrainz could not link it to a page.
async fn wikipedia_fallback(
    artist_name: &str,
    titles: &[String],
    albums: &[String],
    identity: &MbIdentity,
) -> Result<Option<ResolvedArtistPage>, String> {
    let evidence_pages = evidence_search(artist_name, titles, albums).await;
    let mut candidates: Vec<String> = evidence_pages.clone();
    candidates.push(artist_name.trim().to_string());
    match fetch_wikipedia_search_titles_for_query(&format!("\"{}\" musician singer rapper band", artist_name.replace('"', "")), 8).await {
        Ok(found) => candidates.extend(found),
        Err(error) => log::warn!("Wikipedia search for artist {artist_name:?} failed: {error}"),
    }

    let mut seen = Vec::new();
    let mut fetched = 0;
    for candidate in candidates {
        let key = normalize_text(&candidate);
        if key.is_empty() || seen.contains(&key) || !same_artist_name(page_title_core(&candidate), artist_name) {
            continue;
        }
        seen.push(key);
        if fetched == MAX_FALLBACK_PAGES {
            break;
        }
        fetched += 1;

        let Some(summary) = fetch_wikipedia_summary(&candidate).await? else {
            continue;
        };
        let title = summary.title.clone().unwrap_or_else(|| candidate.clone());
        let lead = summary.extract.as_deref().unwrap_or("");
        // Redirects can land somewhere else entirely ("Billy Joel (band)" -> a list of his sidemen).
        if !same_artist_name(page_title_core(&title), artist_name) || summary_kind(&title, &summary) != PageKind::Artist {
            continue;
        }
        let evidence = evidence_pages.iter().any(|page| page == &candidate || page == &title)
            || mentions_any(lead, titles)
            || mentions_any(lead, albums);
        let primary_topic = page_title_core(&title) == title.trim();
        if accept_fallback_page(evidence, primary_topic, identity) {
            return Ok(Some(ResolvedArtistPage { title, summary, mbid: identity.mbid.clone() }));
        }
    }
    Ok(None)
}

/// The Wikipedia page about the act the library calls `artist_name`, or None when no page can be
/// tied to it with confidence. Showing nothing beats showing a stranger's biography.
pub(crate) async fn resolve_artist_page(
    artist_name: &str,
    context: &ArtistContext,
) -> Result<Option<ResolvedArtistPage>, String> {
    let identity = match resolve_musicbrainz_identity(artist_name, context).await {
        Ok(identity) => identity,
        Err(error) if is_offline_error(&error) => return Err(error),
        Err(error) => {
            log::warn!("MusicBrainz identity for {artist_name:?} failed: {error}");
            MbIdentity::default()
        }
    };

    if let Some(title) = identity.wikipedia_title.as_deref() {
        if let Some(summary) = fetch_wikipedia_summary(title).await? {
            let resolved = summary.title.clone().unwrap_or_else(|| title.to_string());
            // The link is authoritative; only a page that turned into a disambiguation, list or
            // song page (a moved article) is refused.
            if matches!(summary_kind(&resolved, &summary), PageKind::Artist | PageKind::Other) {
                return Ok(Some(ResolvedArtistPage { title: resolved, summary, mbid: identity.mbid }));
            }
        }
    }

    let (titles, albums) = context_terms(artist_name, context);
    wikipedia_fallback(artist_name, &titles, &albums, &identity).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(title: &str, credits: &[(&str, &str)]) -> MbCreditedHit {
        MbCreditedHit {
            title: Some(title.to_string()),
            artist_credit: Some(
                credits
                    .iter()
                    .map(|(name, id)| MbCredit {
                        name: Some(name.to_string()),
                        artist: Some(MbCreditArtist { id: id.to_string(), name: Some(name.to_string()) }),
                    })
                    .collect(),
            ),
        }
    }

    #[test]
    fn recordings_vote_for_the_credited_namesake_only() {
        let hits = vec![
            hit("Candy Shop", &[("50 Cent", "fifty"), ("Olivia", "olivia-gunit")]),
            hit("Candy Shop", &[("Olivia", "olivia-gunit")]),
            hit("Candy Shop (Remix)", &[("Olivia", "olivia-other")]),
            hit("Candy Floss", &[("Olivia", "olivia-third")]),
        ];
        let mut votes = Vec::new();
        tally_credited_artists(&hits, "Olivia", "Candy Shop", &mut votes);
        assert_eq!(best_vote(&votes).as_deref(), Some("olivia-gunit"));
        assert!(!votes.iter().any(|(id, _)| id == "fifty" || id == "olivia-third"));
    }

    #[test]
    fn stylised_titles_still_match_recordings() {
        // The library's "F L Y" is MusicBrainz's "F・L・Y".
        let hits = vec![hit("F・L・Y", &[("SPECTRUM", "spectrum-jp")])];
        let mut votes = Vec::new();
        tally_credited_artists(&hits, "Spectrum", "F L Y", &mut votes);
        assert_eq!(best_vote(&votes).as_deref(), Some("spectrum-jp"));
    }

    #[test]
    fn namesakes_count_names_and_aliases_exactly() {
        let artist = |id: &str, name: &str, aliases: &[&str]| MbArtistHit {
            id: id.to_string(),
            name: Some(name.to_string()),
            aliases: Some(aliases.iter().map(|alias| MbAlias { name: Some(alias.to_string()) }).collect()),
        };
        let hits = vec![
            artist("a", "Berlin", &[]),
            artist("b", "Berlin", &[]),
            artist("c", "Berlin Philharmonic", &["Berliner Philharmoniker"]),
            artist("d", "Ye", &["Kanye West"]),
        ];
        assert_eq!(namesake_ids(&hits, "Berlin"), vec!["a".to_string(), "b".to_string()]);
        assert_eq!(namesake_ids(&hits, "Kanye West"), vec!["d".to_string()]);
    }

    #[test]
    fn context_terms_drop_versions_placeholders_and_the_artist_name() {
        let context = ArtistContext {
            titles: vec![
                "Take My Breath Away - 2011 Remaster".to_string(),
                "Take My Breath Away".to_string(),
                "Unknown Title".to_string(),
                "Berlin".to_string(),
                "The Metro".to_string(),
            ],
            albums: vec!["Unknown Album".to_string(), "Pleasure Victim".to_string()],
        };
        let (titles, albums) = context_terms("Berlin", &context);
        assert_eq!(titles, vec!["Take My Breath Away".to_string(), "The Metro".to_string()]);
        assert_eq!(albums, vec!["Pleasure Victim".to_string()]);
        assert!(mentions_any("Berlin had hits with \"Take My Breath Away\" in 1986.", &titles));
        assert!(!mentions_any("Berlin is the capital of Germany.", &titles));
    }

    #[test]
    fn lucene_phrases_escape_quotes() {
        assert_eq!(lucene_phrase("12\" Mix"), "\"12\\\" Mix\"");
    }
}

#[cfg(test)]
mod live_probe {
    use super::*;

    /// Artist, library song titles, library albums, the page it must resolve to (None: any or none).
    type ProbeCase<'a> = (&'a str, &'a [&'a str], &'a [&'a str], Option<&'a str>);

    /// Live network probe over artists the old resolver got wrong or that share their name:
    /// `cargo test -- --ignored artist_identity_live_probe --nocapture`.
    #[test]
    #[ignore]
    fn artist_identity_live_probe() {
        let cases: &[ProbeCase] = &[
            ("Bellini", &["Samba de Janeiro"], &["Samba de Janeiro"], Some("Bellini (German group)")),
            ("Spectrum", &["F L Y"], &["Optical Sunrise/Spectrum2"], None),
            ("Billy Joel", &["Piano Man", "We Didn't Start the Fire"], &["Storm Front"], Some("Billy Joel")),
            ("Berlin", &["Take My Breath Away"], &["Take My Breath Away"], Some("Berlin (band)")),
            ("Player", &["Baby Come Back"], &["Player"], Some("Player (band)")),
            ("Olivia", &["Candy Shop"], &["Best Of 50 Cent"], None),
            ("Drake", &["Way 2 Sexy (with Future & Young Thug)"], &["Certified Lover Boy"], Some("Drake (musician)")),
            ("Kanye West", &["Runaway"], &["My Beautiful Dark Twisted Fantasy"], None),
            ("Tyler, The Creator", &["EARFQUAKE"], &["IGOR"], Some("Tyler, the Creator")),
            ("JAŸ-Z", &["Empire State Of Mind"], &["The Blueprint 3"], Some("Jay-Z")),
            ("Srinivas", &["Endrendrum Punnagai"], &["Alaipayuthey"], Some("Srinivas (singer)")),
            ("Amanda Reifer", &["Die Hard"], &["Mr. Morale & The Big Steppers"], None),
            ("Shaggy", &["It Wasn't Me"], &["Hot Shot"], Some("Shaggy (musician)")),
            ("Nirvana", &["Smells Like Teen Spirit"], &["Nevermind"], Some("Nirvana (band)")),
            ("347aidan", &["Dancing in My Room"], &[], Some("347aidan")),
        ];
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let mut wrong = Vec::new();
        for (name, titles, albums, expected) in cases {
            let context = ArtistContext {
                titles: titles.iter().map(|t| t.to_string()).collect(),
                albums: albums.iter().map(|a| a.to_string()).collect(),
            };
            let started = std::time::Instant::now();
            let resolved = rt.block_on(resolve_artist_page(name, &context));
            let got = match &resolved {
                Ok(Some(page)) => Some(page.title.clone()),
                Ok(None) => None,
                Err(error) => {
                    eprintln!("ERR  {name:<20} {error}");
                    continue;
                }
            };
            let mbid = resolved.ok().flatten().and_then(|page| page.mbid);
            eprintln!(
                "{}  {name:<20} -> {:<28} mbid={:<5} {:.1}s",
                if expected.is_none() || got.as_deref() == *expected { "ok " } else { "BAD" },
                got.as_deref().unwrap_or("(none)"),
                mbid.is_some(),
                started.elapsed().as_secs_f32()
            );
            // `None` expectations are "anything but a wrong act": only checked by eye.
            if expected.is_some() && got.as_deref() != *expected {
                wrong.push(*name);
            }
        }
        assert!(wrong.is_empty(), "resolved to the wrong page: {wrong:?}");
    }
}
