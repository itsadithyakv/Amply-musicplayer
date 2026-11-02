import { Badge, Icon, type IconName } from '@/components/ui';
import { useT, type MessageKey } from '@/i18n';
import type { ProFeature } from '@/services/proFeatures';
import { useProStore } from '@/store/proStore';

export const FEATURE_TITLES: Record<ProFeature, MessageKey> = {
  themes: 'pro.feature.themes.title',
  smartRules: 'pro.feature.smartRules.title',
  encore: 'pro.feature.encore.title',
  miniPlayer: 'pro.feature.miniPlayer.title',
  equalizer: 'pro.feature.equalizer.title',
  crossfade: 'pro.feature.crossfade.title',
  moreMixes: 'pro.feature.moreMixes.title',
  fullStats: 'pro.feature.fullStats.title',
  tagEditor: 'pro.feature.tagEditor.title',
  duplicateFinder: 'pro.feature.duplicateFinder.title',
  gameMode: 'pro.feature.gameMode.title',
  mixTuning: 'pro.feature.mixTuning.title',
  albumNormalization: 'pro.feature.albumNormalization.title',
  visualizerStyles: 'pro.feature.visualizerStyles.title',
};

export const FEATURE_DESCRIPTIONS: Record<ProFeature, MessageKey> = {
  themes: 'pro.feature.themes.description',
  smartRules: 'pro.feature.smartRules.description',
  encore: 'pro.feature.encore.description',
  miniPlayer: 'pro.feature.miniPlayer.description',
  equalizer: 'pro.feature.equalizer.description',
  crossfade: 'pro.feature.crossfade.description',
  moreMixes: 'pro.feature.moreMixes.description',
  fullStats: 'pro.feature.fullStats.description',
  tagEditor: 'pro.feature.tagEditor.description',
  duplicateFinder: 'pro.feature.duplicateFinder.description',
  gameMode: 'pro.feature.gameMode.description',
  mixTuning: 'pro.feature.mixTuning.description',
  albumNormalization: 'pro.feature.albumNormalization.description',
  visualizerStyles: 'pro.feature.visualizerStyles.description',
};

export const FEATURE_ICONS: Record<ProFeature, IconName> = {
  themes: 'sun',
  smartRules: 'smart-mix',
  encore: 'sparkle',
  miniPlayer: 'overlay',
  equalizer: 'eq',
  crossfade: 'shuffle',
  moreMixes: 'sparkle',
  fullStats: 'stats',
  tagEditor: 'edit',
  duplicateFinder: 'list',
  gameMode: 'play',
  mixTuning: 'settings',
  albumNormalization: 'volume',
  visualizerStyles: 'eq',
};

export const ProBadge = () => {
  const { t } = useT();
  return (
    <Badge tone="accent" icon="lock">
      {t('pro.badge')}
    </Badge>
  );
};

/** A Pro setting as a free install sees it: what it does, and one click to the upgrade dialog. */
export const LockedRow = ({ feature }: { feature: ProFeature }) => {
  const { t } = useT();
  const openPaywall = useProStore((state) => state.openPaywall);
  return (
    <button
      type="button"
      onClick={() => openPaywall(feature)}
      className="flex w-full items-start justify-between gap-4 rounded-md px-1 py-2 text-left hover:text-amply-textPrimary"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-amply-textPrimary">{t(FEATURE_TITLES[feature])}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-amply-textSecondary">{t(FEATURE_DESCRIPTIONS[feature])}</span>
      </span>
      <span className="shrink-0">
        <ProBadge />
      </span>
    </button>
  );
};

/** The lock glyph on its own, for controls with no room for the badge. */
export const ProLockIcon = () => <Icon name="lock" size={14} className="text-amply-accent" />;
