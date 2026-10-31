import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyStoredTheme, assertTopLevel } from '../ui/App';
import { createWebPlatform } from './platform';

if (assertTopLevel()) {
  applyStoredTheme();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App platform={createWebPlatform()} />
    </StrictMode>,
  );
}
