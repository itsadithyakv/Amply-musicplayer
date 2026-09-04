import { usePlayerStore } from '@/store/playerStore';
import { Toggle } from '@/components/ui';
import { SettingsSection } from '@/pages/Settings/SettingsSection';

export const OverlaySection = () => {
  const miniNowPlayingOverlay = usePlayerStore((state) => state.settings.miniNowPlayingOverlay);
  const overlayAutoHide = usePlayerStore((state) => state.settings.overlayAutoHide);
  const overlaySpinningArtwork = usePlayerStore((state) => state.settings.overlaySpinningArtwork);

  const setMiniNowPlayingOverlay = usePlayerStore((state) => state.setMiniNowPlayingOverlay);
  const setOverlayAutoHide = usePlayerStore((state) => state.setOverlayAutoHide);
  const setOverlaySpinningArtwork = usePlayerStore((state) => state.setOverlaySpinningArtwork);

  return (
    <SettingsSection icon="overlay" title="Overlay" description="Mini player that stays on top.">
      <div className="grid gap-1">
        <Toggle
          label="Mini Now Playing Overlay"
          description="Show the mini player above other apps."
          checked={miniNowPlayingOverlay}
          onChange={(next) => {
            void setMiniNowPlayingOverlay(next);
          }}
        />
        <Toggle
          label="Auto-hide Overlay"
          description="Hide it while playback is paused."
          checked={overlayAutoHide}
          onChange={(next) => {
            void setOverlayAutoHide(next);
          }}
        />
        <Toggle
          label="Spinning Artwork"
          description="Show album art as a record that turns while music plays."
          checked={overlaySpinningArtwork}
          onChange={(next) => {
            void setOverlaySpinningArtwork(next);
          }}
        />
      </div>
    </SettingsSection>
  );
};
