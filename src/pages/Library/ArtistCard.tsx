import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { useArtistImage } from '@/hooks/useArtistImage';
import { useT } from '@/i18n';

interface ArtistCardProps {
  name: string;
  songCount: number;
  /** Album cover fallback when no artist photo is cached yet. */
  fallbackArtwork?: string;
  onClick: () => void;
}

/** Artist tile that prefers the cached artist photo over an album cover. */
export const ArtistCard = ({ name, songCount, fallbackArtwork, onClick }: ArtistCardProps) => {
  const { tp } = useT();
  const photo = useArtistImage(name);
  return <AlbumCard title={name} subtitle={tp('library.songCount', songCount)} artwork={photo ?? fallbackArtwork} onClick={onClick} />;
};
