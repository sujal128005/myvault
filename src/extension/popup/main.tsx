import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Providers, applyStoredTheme } from '../../ui/App';
import { createExtensionPlatform } from '../platform';
import { PopupRoot } from './Popup';

applyStoredTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers platform={createExtensionPlatform({ popup: true })}>
      <PopupRoot />
    </Providers>
  </StrictMode>,
);
