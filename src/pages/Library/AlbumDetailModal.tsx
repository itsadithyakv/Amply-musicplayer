import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { Badge, Button, Kicker, Meta, Modal, Spinner, Surface } from '@/components/ui';
import type { AlbumTracklist } from '@/services/albumTracklistService';
import type { Song } from '@/types/music';
import { useT } from '@/i18n';
import type { AlbumTrackMatches } from './libraryGroups';

export interface ActiveAlbum extends AlbumTrackMatches {
  album: string;
  artist: string;
  songs: Song[];
  tracklist: AlbumTracklist | null;
  artwork?: string;
  isLoading: boolean;
}

interface AlbumDetailModalProps {
  album: ActiveAlbum | null;
  onClose: () => void;
  onPlay: () => void;
}

export const AlbumDetailModal = ({ album, onClose, onPlay }: AlbumDetailModalProps) => {
  const { t, tp } = useT();
  return (
    <Modal
      open={album !== null}
      onClose={onClose}
      title={album?.album}
      description={album ? tp('library.album.summary', album.total, { artist: album.artist, available: album.available }) : undefined}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('library.album.done')}
          </Button>
          <Button variant="primary" icon="play" onClick={onPlay}>
            {t('library.album.play')}
          </Button>
        </>
      }
    >
      {album ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="neu-well h-16 w-16 shrink-0 overflow-hidden rounded-sm">
              {album.artwork ? <ArtworkImage src={album.artwork} alt={album.album} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0">
              <Kicker>{t('library.album.tracklist')}</Kicker>
              <Meta>{tp('library.trackCount', album.total)}</Meta>
            </div>
          </div>

          <Surface variant="pressed" radius="md" className="max-h-[50vh] overflow-y-auto p-2">
            {album.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-amply-textMuted">
                <Spinner size={14} label={t('library.album.fetchingLabel')} />
                {t('library.album.fetching')}
              </div>
            ) : album.tracklist?.tracks?.length ? (
              <ul className="space-y-1">
                {album.viewItems.map((track) => {
                  const isMissing = !track.available;
                  return (
                    <li
                      key={`${track.position}-${track.title}`}
                      className={`neu-flat flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-[12px] ${isMissing ? 'opacity-40' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-amply-textPrimary">
                          {track.position}. {track.title}
                        </p>
                        <p className="truncate text-[12px] text-amply-textSecondary">{album.album}</p>
                      </div>
                      <Badge tone={isMissing ? 'neutral' : 'success'}>{isMissing ? t('library.album.missing') : t('library.album.available')}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 py-5 text-[13px] text-amply-textMuted">{t('library.album.noTracklist')}</p>
            )}
          </Surface>
        </div>
      ) : null}
    </Modal>
  );
};
