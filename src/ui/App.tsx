import { Component, useEffect, type ReactNode } from 'react';
import { PlatformContext, type Platform } from './platform';
import { VaultProvider, useVault } from './state';
import { ToastProvider } from './toast';
import { Spinner } from './components/primitives';
import { LockView, SetupView } from './views/AuthViews';
import { MainView } from './views/MainView';
import { applyStoredTheme } from './hooks';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  override state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <div className="auth-card">
          <h1 className="auth-title" style={{ fontSize: 24 }}>Something went wrong</h1>
          <p className="auth-sub">Your vault data is safe — it is stored encrypted and was not modified. Reload to continue.</p>
          <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function Router() {
  const { status, data } = useVault();
  useEffect(() => {
    document.title = status === 'unlocked' ? 'MyVault' : 'MyVault — Locked';
  }, [status]);
  if (status === 'loading')
    return (
      <div className="auth">
        <Spinner />
      </div>
    );
  if (status === 'none') return <SetupView />;
  if (status === 'locked' || !data) return <LockView />;
  return <MainView />;
}

export function Providers({ platform, children }: { platform: Platform; children: ReactNode }) {
  return (
    <PlatformContext.Provider value={platform}>
      <ToastProvider>
        <VaultProvider>{children}</VaultProvider>
      </ToastProvider>
    </PlatformContext.Provider>
  );
}

export function App({ platform }: { platform: Platform }) {
  return (
    <Providers platform={platform}>
      <ErrorBoundary>
        <Router />
      </ErrorBoundary>
    </Providers>
  );
}

/** Refuse to run inside a frame (clickjacking defence, in addition to frame-ancestors). */
export function assertTopLevel(): boolean {
  if (window.top !== window.self) {
    document.body.textContent = 'MyVault cannot be displayed inside a frame.';
    return false;
  }
  return true;
}

export { applyStoredTheme };
