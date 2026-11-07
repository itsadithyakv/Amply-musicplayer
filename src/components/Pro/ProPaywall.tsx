import { useEffect, useState } from 'react';
import { Button, Icon, Modal } from '@/components/ui';
import { HardshipRequestButton, ProRequestDialog } from '@/components/Pro/HardshipRequest';
import { FEATURE_DESCRIPTIONS, FEATURE_ICONS, FEATURE_TITLES } from '@/components/Pro/ProGate';
import { useT } from '@/i18n';
import { readPreference, writePreference } from '@/services/preferences';
import { PRO_FEATURES, proFeaturesInUse, type ProFeature } from '@/services/proFeatures';
import { isTauri } from '@/services/storageService';
import { usePlayerStore } from '@/store/playerStore';
import { useProStore, type PurchaseOutcome } from '@/store/proStore';

const INTRO_SEEN_PREFERENCE = 'pro.introSeen';
const TRIAL_ENDED_SEEN_PREFERENCE = 'pro.trialEndedSeen';
const TRIAL_OFFERED_PREFERENCE = 'pro.trialOffered';
const FIRST_SEEN_PREFERENCE = 'pro.firstSeenAt';
/** The trial is offered once, after a day of use, when Amply has had a chance to show what it is. */
const TRIAL_OFFER_AFTER_MS = 24 * 3_600_000;
const isSeen = (value: string): value is '1' => value === '1';
const isTimestamp = (value: string): value is string => /^\d+$/.test(value);

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

/** Once each: a free install is offered the trial after its first day, and told when the trial ends. */
const useTrialNotices = () => {
  const checked = useProStore((state) => state.checked);
  const owned = useProStore((state) => state.owned);
  const trial = useProStore((state) => state.trial);
  const paywallOpen = useProStore((state) => state.paywall !== null);
  const playerReady = usePlayerStore((state) => state.initialized);
  useEffect(() => {
    if (!checked || !playerReady || owned || paywallOpen) {
      return;
    }
    if (trial.endsAt && !trial.active) {
      if (readPreference(TRIAL_ENDED_SEEN_PREFERENCE, isSeen, '' as '1') !== '1') {
        writePreference(TRIAL_ENDED_SEEN_PREFERENCE, '1');
        useProStore.setState({ paywall: { kind: 'trialEnded' } });
      }
      return;
    }
    if (!trial.available) {
      return;
    }
    const firstSeen = Number(readPreference(FIRST_SEEN_PREFERENCE, isTimestamp, ''));
    if (!firstSeen) {
      writePreference(FIRST_SEEN_PREFERENCE, String(Date.now()));
      return;
    }
    if (Date.now() - firstSeen >= TRIAL_OFFER_AFTER_MS && readPreference(TRIAL_OFFERED_PREFERENCE, isSeen, '' as '1') !== '1') {
      writePreference(TRIAL_OFFERED_PREFERENCE, '1');
      useProStore.setState({ paywall: { kind: 'trialOffer' } });
    }
  }, [checked, owned, paywallOpen, playerReady, trial]);
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
  useTrialNotices();
  const request = useProStore((state) => state.paywall);
  const close = useProStore((state) => state.closePaywall);
  const storeInstall = useProStore((state) => state.storeInstall);
  const price = useProStore((state) => state.price);
  const busy = useProStore((state) => state.busy);
  const purchase = useProStore((state) => state.purchase);
  const refresh = useProStore((state) => state.refresh);
  const startTrial = useProStore((state) => state.startTrial);
  const trialAvailable = useProStore((state) => state.trial.available && !state.owned);
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

  const tryPro = async () => {
    const started = await startTrial();
    close();
    showToast(t(started ? 'pro.trial.started' : 'pro.trial.used'));
  };

  const intro = request?.kind === 'intro' ? request : null;
  const title =
    request?.kind === 'intro' ? t('pro.paywall.introTitle')
    : request?.kind === 'trialEnded' ? t('pro.trial.endedTitle')
    : request?.kind === 'trialOffer' ? t('pro.trial.offerTitle')
    : t('pro.paywall.title');
  const description =
    intro ? t('pro.paywall.introBody', { features: intro.features.map((feature) => t(FEATURE_TITLES[feature])).join(', ') })
    : request?.kind === 'trialEnded' ? t('pro.trial.endedBody')
    : request?.kind === 'trialOffer' ? t('pro.trial.offerBody')
    : t('pro.paywall.description');
  const trigger = request?.kind === 'feature' ? request.feature : undefined;
  // The feature that brought the user here comes first, so the answer to "why did this open?" is on top.
  const features = trigger ? [trigger, ...PRO_FEATURES.filter((feature) => feature !== trigger)] : PRO_FEATURES;

  return (
    <>
    <ProRequestDialog />
    <Modal
      open={request !== null}
      onClose={close}
      size="md"
      title={title}
      description={description}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {storeInstall ? (
            <Button variant="ghost" onClick={() => void restore()} loading={restoring} disabled={busy}>
              {t('pro.paywall.restore')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={close}>{t('pro.paywall.notNow')}</Button>
          <Button
            variant={trialAvailable ? 'secondary' : 'primary'}
            icon={storeInstall ? 'sparkle' : 'external-link'}
            onClick={() => void buy()}
            loading={busy}
            disabled={restoring}
          >
            {!storeInstall ? t('pro.paywall.openStore') : price ? t('pro.paywall.buyPrice', { price }) : t('pro.paywall.buy')}
          </Button>
          {trialAvailable ? (
            <Button variant="primary" icon="sparkle" onClick={() => void tryPro()} disabled={busy || restoring}>
              {t('pro.trial.start')}
            </Button>
          ) : null}
        </div>
      }
    >
      <ul className="grid max-h-[46vh] gap-1 overflow-y-auto pr-1">
        {features.map((feature) => (
          <FeatureRow key={feature} feature={feature} highlighted={feature === trigger} />
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-relaxed text-amply-textSecondary">
        {trialAvailable ? `${t('pro.trial.terms')} ` : ''}
        {t(storeInstall ? 'pro.paywall.free' : 'pro.paywall.storeOnly')}
      </p>
      {storeInstall || !isTauri() ? (
        <div className="mt-3">
          <HardshipRequestButton />
        </div>
      ) : null}
    </Modal>
    </>
  );
};
