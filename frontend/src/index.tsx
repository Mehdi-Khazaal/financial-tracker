import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installPreloadErrorRecovery, registerServiceWorker } from './lib/serviceWorker';

// If a deploy lands mid-session and a lazy route's chunk is gone, reload
// once rather than showing a broken page. Installed before the first render
// so the very first lazy import is covered.
installPreloadErrorRecovery();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerServiceWorker();
