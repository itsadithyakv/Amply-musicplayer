import { useEffect, useState } from 'react';
import { Button, Icon, Modal } from '@/components/ui';
import { FEATURE_DESCRIPTIONS, FEATURE_ICONS, FEATURE_TITLES } from '@/components/Pro/ProGate';
import { useT } from '@/i18n';
import { readPreference, writePreference } from '@/services/preferences';
import { PRO_FEATURES, proFeaturesInUse, type ProFeature } from '@/services/proFeatures';
import { usePlayerStore } from '@/store/playerStore';
import { useProStore, type PurchaseOutcome } from '@/store/proStore';

const INTRO_SEEN_PREFERENCE = 'pro.introSeen';
const isSeen = (value: string): value is '1' => value === '1';

/**
 * Once, after the first Store answer: someone who was using a feature that is now Pro hears why it
 * stopped working instead of finding it broken. Fresh installs have nothing in use and see nothing.
 */
const useChangeNotice = () => {
  const checked = useProStore((state) => state.checked);
  const isPro = useProStore((state) => state.isPro);
  const showIntro = useProStore((state) => state.showIntro);
  const playerReady = usePlayerStore((state) => state.initialized);
  useEffect(() => {
    if (!checked || !playerReady || readPreference(INTRO_SEEN_PREFERENCE, isSeen, '' as '1') === '1') {
      return;
    }
    writePreference(INTRO_SEEN_PREFERENCE, '1');
    const inUse = proFeaturesInUse(usePlayerStore.getState().settings);
    if (!isPro && inUse.length) {
      showIntro(inUse);
    }
  }, [checked, isPro, playerReady, showIntro]);
};

const FeatureRow = ({ feature, highlighted }: { feature: ProFeature; highlighted: boolean }) => {
  const { t } = useT();
  return (
    <li className={highlighted ? 'neu-pressed-sm flex items-start gap-3 rounded-md p-2' : 'flex items-start gap-3 p-2'}>
      <Icon name={FEATURE_ICONS[feature]} size={16} className="mt-0.5 shrink-0 text-amply-accent" />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-amply-textPrimary">{t(FEATURE_TITLES[feature])}</span>
        <span className="block text-[12px] leading-relaxed text-amply-textSecondary">{t(FEATURE_DESCRIPTIONS[feature])}</span>
      </span>
    </li>
  );
};

/** The one upgrade dialog; every lock in the app opens it through `useProStore.openPaywall`. */
export const ProPaywall = () => {
  const { t } = useT();
  useChangeNotice();
  const request = useProStore((state) => state.paywall);
  const close = useProStore((state) => state.closePaywall);
  const storeInstall = useProStore((state) => state.storeInstall);
  const price = useProStore((state) => state.price);
  const busy = useProStore((state) => state.busy);
  const purchase = useProStore((state) => state.purchase);
  const refresh = useProStore((state) => state.refresh);
  const showToast = usePlayerStore((state) => state.showToast);
  const [restoring, setRestoring] = useState(false);

  const buy = async () => {
    const outcome: PurchaseOutcome = await purchase();
    if (outcome === 'purchased' || outcome === 'already-owned') {
      close();
      showToast(t(outcome === 'purchased' ? 'pro.toast.purchased' : 'pro.toast.unlocked'));
    } else if (outcome === 'network-error') {
      showToast(t('pro.toast.network'));
    } else if (outcome === 'failed') {
      showToast(t('pro.toast.failed'));
    }
  };

  const restore = async () => {
    setRestoring(true);
    const isPro = await refresh();
    setRestoring(false);
    if (isPro) {
      close();
      showToast(t('pro.toast.unlocked'));
    } else {
      showToast(t('pro.toast.notFound'));
    }
  };

  const intro = request?.kind === 'intro' ? request : null;
  const trigger = request?.kind === 'feature' ? request.feature : undefined;
  // The feature that brought the user here comes first, so the answer to "why did this open?" is on top.
  const features = trigger ? [trigger, ...PRO_FEATURES.filter((feature) => feature !== trigger)] : PRO_FEATURES;

  return (
    <Modal
      open={request !== null}
      onClose={close}
      size="md"
      title={intro ? t('pro.paywall.introTitle') : t('pro.paywall.title')}
      description={
        intro
          ? t('pro.paywall.introBody', { features: intro.features.map((feature) => t(FEATURE_TITLES[feature])).join(', ') })
          : t('pro.paywall.description')
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {storeInstall ? (
            <Button variant="ghost" onClick={() => void restore()} loading={restoring} disabled={busy}>
              {t('pro.paywall.restore')}
            </Button>
          ) : null}
          <Button onClick={close}>{t('pro.paywall.notNow')}</Button>
          <Button variant="primary" icon={storeInstall ? 'sparkle' : 'external-link'} onClick={() => void buy()} loading={busy} disabled={restoring}>
            {!storeInstall ? t('pro.paywall.openStore') : price ? t('pro.paywall.buyPrice', { price }) : t('pro.paywall.buy')}
          </Button>
        </div>
      }
    >
      <ul className="grid max-h-[46vh] gap-1 overflow-y-auto pr-1">
        {features.map((feature) => (
          <FeatureRow key={feature} feature={feature} highlighted={feature === trigger} />
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-relaxed text-amply-textSecondary">{t(storeInstall ? 'pro.paywall.free' : 'pro.paywall.storeOnly')}</p>
    </Modal>
  );
};
