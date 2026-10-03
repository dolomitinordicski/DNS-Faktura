import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PublicConfirmationPage } from './components/PublicConfirmationPage';
import { applyDNSDesignSystem } from './services/designSystem';
import './styles/index.css';

applyDNSDesignSystem();

const confirmationToken = new URLSearchParams(window.location.search).get(
  'confirmation',
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {confirmationToken ? (
      <PublicConfirmationPage rawToken={confirmationToken} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
