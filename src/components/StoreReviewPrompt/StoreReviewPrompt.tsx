import { useEffect, useState } from 'react';
import { Button, Card, Icon } from '@/components/ui';
import {
  isStoreInstall,
  readReviewPromptState,
  recordReviewPromptEvent,
  requestStoreReview,
  shouldPromptForReview,
} from '@/services/storeReview';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

/** How long into a session before the prompt may appear: never at launch, never mid-setup. */
const PROMPT_DELAY_MS = 3 * 60_000;

/**
 * A one-card ask for a Microsoft Store rating. Shown at most once per session, only to Store
 * installs, and only when `shouldPromptForReview` allows (a week of use, 30 plays, not snoozed).
 */
export const StoreReviewPrompt = () => {
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const showToast = usePlayerStore((state) => state.showToast);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (gameMode) {
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!(await isStoreInstall()) || !alive || usePlayerStore.getState().settings.gameMode) {
          return;
        }
        const totalPlays = useLibraryStore.getState().songs.reduce((sum, song) => sum + (song.playCount ?? 0), 0);
        const now = Date.now();
        if (shouldPromptForReview(readReviewPromptState(now), totalPlays, now)) {
          recordReviewPromptEvent('shown', now);
          setVisible(true);
        }
      })();
    }, PROMPT_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [gameMode]);

  if (!visible) {
    return null;
  }

  const answer = (event: 'later' | 'never') => {
    recordReviewPromptEvent(event);
    setVisible(false);
  };

  const rate = async () => {
    setBusy(true);
    const outcome = await requestStoreReview();
    recordReviewPromptEvent(outcome);
    setBusy(false);
    setVisible(false);
    if (outcome === 'rated') {
      showToast('Thanks for rating Amply!');
    } else if (outcome === 'failed') {
      showToast("Couldn't open the Microsoft Store");
    }
  };

  return (
    <div className="anim-toast-in absolute bottom-24 right-6 z-toast w-[300px]" role="region" aria-label="Rate Amply">
      <Card padding="md">
        <div className="flex items-start gap-3">
          <span className="neu-pressed-sm inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-amply-accent">
            <Icon name="heart" size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-amply-textPrimary">Enjoying Amply?</p>
            <p className="mt-1 text-[12px] leading-snug text-amply-textSecondary">
              A quick rating on the Microsoft Store helps other people find it.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => answer('never')} disabled={busy}>
            Don't ask again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => answer('later')} disabled={busy}>
            Not now
          </Button>
          <Button variant="primary" size="sm" onClick={() => void rate()} loading={busy}>
            Rate
          </Button>
        </div>
      </Card>
    </div>
  );
};
