import clsx from 'clsx';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid, type GridChildComponentProps } from 'react-window';
import { useNavigate } from 'react-router-dom';
import PlaylistComposer from '@/components/Playlists/PlaylistComposer';
import addIcon from '@/assets/icons/add.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Playlist } from '@/types/music';

const PlaylistsPage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const playlists = useLibraryStore((state) => state.playlists);
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const navigate = useNavigate();

  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);

  const [showComposer, setShowComposer] = useState(false);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const clickTimerRef = useRef<number | null>(null);
  const clickTargetRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickTargetRef.current = null;
    };
  }, []);

  const handleCardClick = (id: string, onClick: () => void, onDoubleClick: () => void) => {
    if (clickTimerRef.current && clickTargetRef.current !== id) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (clickTimerRef.current && clickTargetRef.current === id) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      clickTargetRef.current = null;
      onDoubleClick();
      return;
    }
    clickTargetRef.current = id;
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      clickTargetRef.current = null;
      onClick();
    }, 220);
  };

  const playlistToneClasses = [
    'bg-gradient-to-br from-[#1f2a45] via-[#151b26] to-[#0f1218]',
    'bg-gradient-to-br from-[#3a2614] via-[#22170e] to-[#14110c]',
    'bg-gradient-to-br from-[#1a352d] via-[#121f1b] to-[#0c1311]',
    'bg-gradient-to-br from-[#3a1d34] via-[#23131f] to-[#130b11]',
  ];

  const playlistGlowClasses = [
    'shadow-[0_0_0_1px_rgba(90,130,255,0.16),0_14px_30px_rgba(17,24,39,0.6)]',
    'shadow-[0_0_0_1px_rgba(255,170,90,0.16),0_14px_30px_rgba(20,12,8,0.6)]',
    'shadow-[0_0_0_1px_rgba(96,220,170,0.16),0_14px_30px_rgba(9,16,13,0.6)]',
    'shadow-[0_0_0_1px_rgba(210,120,230,0.16),0_14px_30px_rgba(17,10,15,0.6)]',
  ];

  const playlistCards = useMemo(() => {
    const mapArtworkSet = (playlist: Playlist): string[] => {
      const artSet = new Set<string>();
      for (const songId of playlist.songIds) {
        const song = songById.get(songId);
        if (song?.albumArt) {
          artSet.add(song.albumArt);
        }
        if (artSet.size >= 4) {
          break;
        }
      }
      const list = [...artSet];
      if (list.length) {
        while (list.length < 4) {
          list.push(list[list.length - 1]);
        }
      }
      return list;
    };

    return playlists.map((playlist) => {
      const firstSong = playlist.songIds.map((id) => songById.get(id)).find(Boolean);
      return {
        playlist,
        artworkSet: mapArtworkSet(playlist),
        firstSongId: firstSong?.id,
      };
    });
  }, [playlists, songById]);

  const smartPlaylistCards = useMemo(
    () => playlistCards.filter((card) => card.playlist.type === 'smart' || card.playlist.type === 'daily'),
    [playlistCards],
  );
  const customPlaylistCards = useMemo(
    () => playlistCards.filter((card) => card.playlist.type === 'custom'),
    [playlistCards],
  );

  const PlaylistCard = ({
    playlist,
    artworkSet,
    firstSongId,
    index,
  }: {
    playlist: Playlist;
    artworkSet: string[];
    firstSongId?: string;
    index: number;
  }) => {
    const backgroundStyle = artworkSet[0]
      ? {
          backgroundImage: `linear-gradient(140deg, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.5)), url(${artworkSet[0]})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundBlendMode: 'overlay',
        }
      : undefined;

    return (
      <div
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[data-play-button="true"]')) {
            return;
          }
          handleCardClick(
            playlist.id,
            () => {
              if (!playlist.songIds.length || !firstSongId) {
                return;
              }
              setQueue(playlist.songIds, firstSongId);
              void playSongById(firstSongId, false);
            },
            () => navigate(`/playlist/${playlist.id}`),
          );
        }}
        className={clsx(
          'playlist-card playlist-card--stable group relative h-full overflow-hidden rounded-card border border-amply-border/60 p-5 transition-[transform,box-shadow,filter] duration-300 ease-smooth hover:shadow-lift',
          playlistToneClasses[index % playlistToneClasses.length],
          playlistGlowClasses[index % playlistGlowClasses.length],
        )}
        style={backgroundStyle}
        title="Click to play · Double-click to open"
      >
        {artworkSet[0] ? (
          <div className="blur-backdrop playlist-backdrop">
            <img src={artworkSet[0]} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
          </div>
        ) : null}

        <div className="glass-overlay" />

        <div className="relative flex h-full flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="playlist-text-shadow text-[18px] font-semibold text-amply-textPrimary">{playlist.name}</p>
              <span className="rounded-full border border-amply-border/60 bg-black/35 px-2 py-0.5 text-[11px] text-amply-textSecondary">
                {playlist.songIds.length} songs
              </span>
            </div>
            <p className="playlist-text-shadow line-clamp-2 text-[12px] text-amply-textSecondary">
              {playlist.description || 'Curated playlist'}
            </p>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div className="artwork-collage artwork-collage--inline max-w-[220px]">
              {[0, 1, 2, 3].map((slot) => {
                const art = artworkSet[slot] ?? artworkSet[0];
                return (
                  <div
                    key={`${playlist.id}-art-${slot}`}
                    className="artwork-tile h-16 w-16 bg-gradient-to-br from-[#1d1f2a] via-[#12151f] to-[#0c0f17]"
                  >
                    {art ? <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : null}
                  </div>
                );
              })}
            </div>

            <button
              data-play-button="true"
              type="button"
              onClick={() => {
                if (!playlist.songIds.length || !firstSongId) {
                  return;
                }
                setQueue(playlist.songIds, firstSongId);
                void playSongById(firstSongId, false);
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amply-accent text-black transition-colors hover:bg-amply-accentHover"
              aria-label="Play playlist"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  };


  const PlaylistCell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
    const { items, columnCount } = data as {
      items: Array<{ playlist: Playlist; artworkSet: string[]; firstSongId?: string }>;
      columnCount: number;
    };
    const index = rowIndex * columnCount + columnIndex;
    const item = items[index];
    if (!item) {
      return null;
    }
    const { playlist, artworkSet, firstSongId } = item;

    return (
      <div style={style} className="p-2">
        <PlaylistCard playlist={playlist} artworkSet={artworkSet} firstSongId={firstSongId} index={index} />
      </div>
    );
  });



  const renderPlaylistSection = (
    title: string,
    description: string,
    items: Array<{ playlist: Playlist; artworkSet: string[]; firstSongId?: string }>,
  ) => {
    if (!items.length) {
      return null;
    }

    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-[20px] font-semibold text-amply-textPrimary">{title}</h2>
          <p className="text-[12px] text-amply-textSecondary">{description}</p>
        </div>

        {items.length <= 12 ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {items.map((item, index) => (
              <div key={item.playlist.id} className="h-full">
                <PlaylistCard
                  playlist={item.playlist}
                  artworkSet={item.artworkSet}
                  firstSongId={item.firstSongId}
                  index={index}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="h-[70vh] overflow-hidden rounded-card border border-amply-border/40">
            <AutoSizer>
              {({ height, width }) => {
                const columnCount = Math.max(1, Math.floor(width / 420));
                const rowCount = Math.ceil(items.length / columnCount);
                return (
                  <Grid
                    columnCount={columnCount}
                    columnWidth={Math.floor(width / columnCount)}
                    height={height}
                    rowCount={rowCount}
                    rowHeight={320}
                    width={width}
                    itemData={{ items, columnCount }}
                    overscanRowCount={2}
                  >
                    {PlaylistCell}
                  </Grid>
                );
              }}
            </AutoSizer>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-5 pb-8">
      <header className="space-y-1">
        <h1 className="text-[30px] font-bold tracking-tight text-amply-textPrimary">Playlists</h1>
        <p className="text-[13px] text-amply-textSecondary">Custom playlists and smart mixes.</p>
      </header>

      <div className="rounded-card border border-amply-border bg-amply-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[18px] font-bold text-amply-textPrimary">Create Playlist</p>
            <p className="text-[13px] text-amply-textSecondary">Build a custom playlist with your own cover image and description.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowComposer((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
          >
            <img src={addIcon} alt="" className="h-4 w-4 brightness-0 invert" />
            {showComposer ? 'Close' : 'New Playlist'}
          </button>
        </div>

        {showComposer ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setShowComposer(false)}
          >
            <div
              className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-card border border-amply-border bg-amply-card shadow-card"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-amply-border px-5 py-4">
                <div>
                  <p className="text-[16px] font-semibold text-amply-textPrimary">Create Playlist</p>
                  <p className="text-[12px] text-amply-textMuted">Add details and pick songs to include.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowComposer(false)}
                  className="rounded-md border border-amply-border px-3 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[calc(90vh-64px)] overflow-y-auto px-5 py-4">
                <PlaylistComposer
                  songs={songs}
                  onSave={(playlist) => {
                    void upsertCustomPlaylist(playlist).then(() => {
                      setShowComposer(false);
                    });
                  }}
                  onCancel={() => setShowComposer(false)}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {renderPlaylistSection('Smart Playlists', 'Auto-generated mixes and daily rotations.', smartPlaylistCards)}
      {renderPlaylistSection('Your Playlists', 'Playlists you created or curated manually.', customPlaylistCards)}
    </div>
  );
};

export default PlaylistsPage;
