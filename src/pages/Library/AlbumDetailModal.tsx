import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { Badge, Button, Kicker, Meta, Modal, Spinner, Surface } from '@/components/ui';
import type { AlbumTracklist } from '@/services/albumTracklistService';
import type { Song } from '@/types/music';
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

export const AlbumDetailModal = ({ album, onClose, onPlay }: AlbumDetailModalProps) => (
  <Modal
    open={album !== null}
    onClose={onClose}
    title={album?.album}
    description={album ? `${album.artist} · ${album.available}/${album.total} tracks available` : undefined}
    size="md"
    footer={
      <>
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
        <Button variant="primary" icon="play" onClick={onPlay}>
          Play Album
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
            <Kicker>Tracklist</Kicker>
            <Meta>{album.total} tracks</Meta>
          </div>
        </div>

        <Surface variant="pressed" radius="md" className="max-h-[50vh] overflow-y-auto p-2">
          {album.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-amply-textMuted">
              <Spinner size={14} label="Fetching album tracklist" />
              Fetching album tracklist...
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
                    <Badge tone={isMissing ? 'neutral' : 'success'}>{isMissing ? 'Missing' : 'Available'}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-5 text-[13px] text-amply-textMuted">No tracklist cached yet for this album.</p>
          )}
        </Surface>
      </div>
    ) : null}
  </Modal>
);
