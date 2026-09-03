import { Suspense, lazy } from 'react';
import { useLocation } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
import { recordPerfEvent } from '@/services/perfDiagnostics';
import { requestSafeModeNextStart } from '@/services/safeModeService';

// Both branches are lazy so the tiny always-on-top overlay window never evaluates the main shell.
const OverlayPage = lazy(() => import('@/pages/Overlay'));
const AppShell = lazy(() => import('@/AppShell'));

const OverlayFallback = () => (
  <div className="flex h-full min-h-[64px] items-center justify-center text-[12px] text-amply-textSecondary">Overlay unavailable.</div>
);

const App = () => {
  const location = useLocation();
  const isOverlayRoute =
    location.pathname === '/overlay' || (typeof window !== 'undefined' && window.location.hash?.includes('/overlay'));

  if (isOverlayRoute) {
    return (
      <ErrorBoundary
        fallback={<OverlayFallback />}
        onError={(error) => {
          recordPerfEvent('app.ui-error', { surface: 'overlay', message: error.message });
          void requestSafeModeNextStart('ui-error:overlay');
        }}
      >
        <Suspense fallback={null}>
          <OverlayPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <Suspense fallback={<div className="h-screen w-full bg-amply-bg" />}>
      <AppShell />
    </Suspense>
  );
};

export default App;
