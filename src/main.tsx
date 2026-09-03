import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from '@/App';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
import { primeStartupSafetyFlags, requestSafeModeNextStart } from '@/services/safeModeService';
import '@/index.css';
// Temporary compatibility layer for not-yet-migrated pages; deleted at the end of Phase A6.
import '@/styles/legacy.css';

if (window.location.hash.includes('/overlay')) {
  document.documentElement.dataset.amplyWindow = 'overlay';
}

if (import.meta.env.PROD) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
}

primeStartupSafetyFlags();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      onError={() => {
        void requestSafeModeNextStart('root-error-boundary');
      }}
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-amply-bgPrimary p-6 text-center text-[13px] text-amply-textSecondary">
          Amply could not start cleanly. Restart the app to try recovery mode.
        </div>
      }
    >
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
