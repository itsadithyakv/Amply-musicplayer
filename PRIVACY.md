# Amply Privacy Policy

Effective 2 November 2026. Applies to Amply Music Player 1.8 and later, published by PaperKite.

Amply plays music files that are already on your PC. It has no accounts, no analytics, no advertising
and no servers of its own. Amply does not collect, sell or share personal information. The only thing
that ever reaches the developer is a bug report you choose to send (see below).

## What stays on your PC

Your library, play counts, listening history, playlists, smart playlist rules, Amply Encore, settings,
equalizer presets and cached artwork, lyrics and artist details are stored only in Amply's app data
folder on your PC. None of it is uploaded anywhere. A backup you export is a file you save yourself, and
it leaves out machine-specific settings such as your Last.fm API key.

## What Amply looks up online

To fill in missing cover art, artist photos, artist details, genres, album tracklists and lyrics, Amply
sends the **song title, artist name and album name** of tracks in your library to the public services
below. It sends nothing else about you: no file paths, no listening history and no identifiers. As with
any internet request, each service also sees your IP address and Amply's version number.

| Service | Used for | Privacy policy |
|---|---|---|
| Wikipedia, Wikidata and Wikimedia Commons | Artist photos, artist details, genres | https://foundation.wikimedia.org/wiki/Policy:Privacy_policy |
| MusicBrainz | Artist and recording details, genres, album tracklists | https://metabrainz.org/privacy |
| Apple iTunes Search | Cover art, genres | https://www.apple.com/legal/privacy/ |
| LRCLIB | Synced lyrics | https://lrclib.net |
| Last.fm (only if you turn it on, see below) | Online recommendations | https://www.last.fm/legal/privacy |

Results are cached on your PC, so each track is normally looked up only once.

**Online Recommendations** are off unless you turn them on in Settings. When they are on, Amply sends
artist and song names to MusicBrainz, and to Last.fm only if you enter your own Last.fm API key. That
key is stored on your PC and sent only to Last.fm.

## Microsoft Store

Amply Pro is a one-time add-on sold through the Microsoft Store. Amply asks the Store whether your
Microsoft account owns Amply Pro, and the Store handles the purchase and any rating you leave. Amply
never sees your payment details. Microsoft processes this under the Microsoft Privacy Statement:
https://privacy.microsoft.com/privacystatement. Amply keeps a copy of the licence result on your PC so
Pro keeps working offline.

## Bug reports

**Settings > App Version > Report a problem** lets you send a bug report or an idea to the developer.
Nothing is sent until you press **Send report**, and the dialog shows exactly what will go.

A report contains:

- What you type: the report type, a summary, a description, and optional steps to reproduce.
- Your email address, only if you enter one, so the developer can reply.
- Amply's version, whether you have Amply Pro, and the language Amply is set to. These are always
  included and say nothing about you.
- Technical details, only if **Include technical details** is on (it is on by default, and you can
  preview it or turn it off before sending): your Windows version, whether Amply came from the
  Microsoft Store, the number of songs in your library, the last errors Amply hit, and the last lines
  of Amply's log. Amply replaces your Windows user folder (`C:\Users\<name>`) with `~` in everything it
  sends, including what you type, so your Windows account name is not included. Other folder and file
  names may still appear in the log, for example the name of a song that failed to play.

Reports are delivered by email through EmailJS, which receives the report and your IP address in
order to send it: https://www.emailjs.com/legal/privacy-policy/. The email arrives in the developer's
inbox, is used only to fix the problem or answer you, and is deleted once it is no longer needed. Ask
at the address below to have a report you sent deleted.

## Your choices

- Turn on **Settings > Library Data > Pause Metadata Lookups** to stop all online lookups. Amply keeps
  working with the tags and artwork already in your files.
- Leave **Online Recommendations** off, or remove your Last.fm API key.
- Use **Settings > Library Data > Clear Cache** to delete cached artwork, lyrics and artist details,
  or uninstall Amply to remove all of its data from your PC.
- Send a bug report without technical details or an email address, or don't send one at all.

## Children

Amply does not knowingly collect information from children under 13. If a child has sent a bug report
with an email address, ask at the address below and it will be deleted.

## Changes

If this policy changes, the new version will be published here with a new effective date. A change
that makes Amply send more data will also be noted in the release notes.

## Contact

Questions about this policy: adithyakrishnan.vinod@gmail.com, or open an issue at
https://github.com/itsadithyakv/Amply-musicplayer/issues.
