import { usePlayerStore } from '@/store/playerStore';
import { Toggle } from '@/components/ui';
import { useT } from '@/i18n';
import { SettingsSection } from '@/pages/Settings/SettingsSection';

export const OverlaySection = () => {
  const { t } = useT();
  const miniNowPlayingOverlay = usePlayerStore((state) => state.settings.miniNowPlayingOverlay);
  const overlayAutoHide = usePlayerStore((state) => state.settings.overlayAutoHide);
  const overlaySpinningArtwork = usePlayerStore((state) => state.settings.overlaySpinningArtwork);

  const setMiniNowPlayingOverlay = usePlayerStore((state) => state.setMiniNowPlayingOverlay);
  const setOverlayAutoHide = usePlayerStore((state) => state.setOverlayAutoHide);
  const setOverlaySpinningArtwork = usePlayerStore((state) => state.setOverlaySpinningArtwork);

  return (
    <SettingsSection icon="overlay" title={t('settings.overlay.title')} description={t('settings.overlay.description')}>
      <div className="grid gap-1">
        <Toggle
          label={t('settings.overlay.mini.label')}
          description={t('settings.overlay.mini.description')}
          checked={miniNowPlayingOverlay}
          onChange={(next) => {
            void setMiniNowPlayingOverlay(next);
          }}
        />
        <Toggle
          label={t('settings.overlay.autoHide.label')}
          description={t('settings.overlay.autoHide.description')}
          checked={overlayAutoHide}
          onChange={(next) => {
            void setOverlayAutoHide(next);
          }}
        />
        <Toggle
          label={t('settings.overlay.spinning.label')}
          description={t('settings.overlay.spinning.description')}
          checked={overlaySpinningArtwork}
          onChange={(next) => {
            void setOverlaySpinningArtwork(next);
          }}
        />
      </div>
    </SettingsSection>
  );
};
