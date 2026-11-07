# Amply Privacy Policy

Effective 7 November 2026. Applies to Amply Music Player 1.8 and later for Windows and to Amply for
Android, both published by PaperKite.

Amply plays music files that are already on your PC or phone. It has no accounts, no analytics, no
advertising and no servers of its own. Amply does not collect, sell or share personal information. The
only things that ever reach the developer are a bug report or a request for a free Pro code that you
choose to send (see below).

## What stays on your device

Your library, play counts, listening history, playlists, smart playlist rules, Amply Encore, settings,
equalizer presets and cached artwork, lyrics and artist details are stored only in Amply's app data
folder on your PC or phone. Amply does not upload any of it. A backup you export on Windows is a file
you save yourself, and it leaves out machine-specific settings such as your Last.fm API key.

**On Android**, Amply's data lives in its private app storage. If you have turned on your phone's own
backup (Settings > Google > Backup on most phones), Android may include Amply's data in the backup it
keeps in your Google account, as it does for other apps; Google handles that backup under the Google
Privacy Policy: https://policies.google.com/privacy. An Amply Encore card is saved to Pictures/Amply on
your phone only when you tap **Save card**, and stays there until you delete it.

## What Amply looks up online

To fill in missing cover art, artist photos, artist details, genres, album tracklists and lyrics, Amply
sends the **song title, artist name and album name** of tracks in your library to the public services
below. It sends nothing else about you: no file paths, no listening history and no identifiers. As with
any internet request, each service also sees your IP address and Amply's version number.

| Service | Used for | Privacy policy |
|---|---|---|
| Wikipedia, Wikidata and Wikimedia Commons | Artist photos, artist details, genres | https://foundation.wikimedia.org/wiki/Policy:Privacy_policy |
| MusicBrainz | Artist and recording details, genres, album tracklists | https://metabrainz.org/privacy |
| Apple iTunes Search | Cover art, genres (Windows only) | https://www.apple.com/legal/privacy/ |
| LRCLIB | Synced lyrics | https://lrclib.net |
| Last.fm (Windows only, if you turn it on, see below) | Online recommendations | https://www.last.fm/legal/privacy |

Results are cached on your device, so each track is normally looked up only once.

**On Android**, Amply uses three of these services: LRCLIB for lyrics (song title, artist name and
album name), MusicBrainz for genres (song title and artist name) and Wikipedia for artist details
(artist name). Cover art comes from your music files and your phone, not from the internet.

**Online Recommendations** (Windows) are off unless you turn them on in Settings. When they are on,
Amply sends artist and song names to MusicBrainz, and to Last.fm only if you enter your own Last.fm API
key. That key is stored on your PC and sent only to Last.fm.

## Buying Amply Pro

Amply Pro is a one-time purchase. Amply never sees your payment details, and it keeps a copy of the
purchase result on your device so Pro keeps working offline.

- **On Windows**, Amply Pro is an add-on sold through the Microsoft Store. Amply asks the Store whether
  your Microsoft account owns Amply Pro, and the Store handles the purchase and any rating you leave.
  Microsoft processes this under the Microsoft Privacy Statement:
  https://privacy.microsoft.com/privacystatement.
- **On Android**, Amply Pro is an in-app purchase sold through Google Play. Amply asks Google Play
  whether your Google account owns Amply Pro, and Google Play handles the purchase. Google processes
  this under the Google Privacy Policy: https://policies.google.com/privacy.
- **The 7-day free trial** (Windows) can be started once per Windows account. Amply records when it
  started, and the last time Amply saw the clock, in its own storage and in Windows Credential Manager
  on your PC, so that reinstalling Amply does not start a new trial. This record never leaves your PC.
  You can see it in Credential Manager as "Amply Music Player/Pro trial".
- **A promotional code** for Amply Pro is redeemed with Microsoft at https://redeem.microsoft.com, the
  same way as a purchase; Amply only learns that your account now owns Amply Pro.

## Android permissions and system features

- **Music and audio** lets Amply find the songs on your phone. If you prefer, you can skip it and pick
  a music folder instead.
- **Notifications** lets Amply show the playback controls. The song title, artist and cover appear in
  the notification and on your lock screen while music plays; your phone's notification settings can
  hide them on the lock screen.
- **Internet** is used only for the lookups and bug reports described here.
- **Android Auto and Google Assistant** can browse your Amply library and start music through Android's
  media controls. The library stays on your phone and is shown to them only while they are connected.
  When you ask the Assistant to play something on Amply, Google turns your voice into text under the
  Google Privacy Policy and passes Amply only that text.
- **Opening a file with Amply** from another app plays it on your phone; Amply does not copy or upload
  it.

## Bug reports

**Settings > App Version > Report a problem** on Windows, or **Settings > About > Report a problem** on
Android, lets you send a bug report or an idea to the developer. Nothing is sent until you press
**Send**, and the dialog shows exactly what will go.

A report contains:

- What you type: the report type, a summary, a description, and optional steps to reproduce.
- Your email address, only if you enter one, so the developer can reply.
- Amply's version, whether you have Amply Pro, and the language Amply is set to. These are always
  included and say nothing about you.
- Technical details, only if **Include technical details** (Windows) or **Include device details**
  (Android) is on. It is on by default, and you can see it or turn it off before sending.
  - On Windows: your Windows version, whether Amply came from the Microsoft Store, the number of songs
    in your library, the last errors Amply hit, and the last lines of Amply's log. Amply replaces your
    Windows user folder (`C:\Users\<name>`) with `~` in everything it sends, including what you type,
    so your Windows account name is not included. Other folder and file names may still appear in the
    log, for example the name of a song that failed to play.
  - On Android: your Android version, your phone's maker and model, and the number of songs in your
    library. No log or file names are sent.

Reports are delivered by email through EmailJS, which receives the report and your IP address in
order to send it: https://www.emailjs.com/legal/privacy-policy/. The email arrives in the developer's
inbox, is used only to fix the problem or answer you, and is deleted once it is no longer needed. Ask
at the address below to have a report you sent deleted.

## Asking for a free Pro code

If you have used the trial and can't afford Amply Pro, the upgrade dialog lets you ask the developer
for a free promotional code. The request contains your email address, so the code can be sent to you,
a short note about your situation in your own words, and Amply's version and language. Nothing else
is included. It is delivered by EmailJS in the same way as a bug report, is used only to reply to you
with a code, and is deleted once it has been answered.

## Your choices

- On Windows, turn on **Settings > Library Data > Pause Metadata Lookups** to stop all online lookups.
  On Android, turn on **Settings > Library intelligence > Pause metadata fetching** to stop automatic
  lookups; Amply then looks up lyrics only when you tap **Find lyrics**. Amply keeps working with the
  tags and artwork already in your files.
- Leave **Online Recommendations** off, or remove your Last.fm API key (Windows).
- Use **Settings > Library Data > Clear Cache** (Windows) to delete cached artwork, lyrics and artist
  details. On Android, clear Amply's storage in your phone's app settings.
- Uninstall Amply to remove all of its data from your device.
- Send a bug report without technical details or an email address, or don't send one at all.
- Delete the trial record in Windows Credential Manager if you uninstall Amply for good.

## Children

Amply does not knowingly collect information from children under 13. If a child has sent a bug report
with an email address, ask at the address below and it will be deleted.

## Changes

If this policy changes, the new version will be published here with a new effective date. A change
that makes Amply send more data will also be noted in the release notes.

## Contact

Questions about this policy: adithyakrishnan.vinod@gmail.com, or open an issue at
https://github.com/itsadithyakv/Amply-musicplayer/issues.
