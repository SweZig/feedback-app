import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Service Worker — avregistrerad medvetet (Sprint A.6).
//
// CRA v4+ genererar inte längre någon service-worker.js automatiskt.
// register() failade därför med MIME-fel ('text/html') eftersom Vercel
// serverade SPA-fallback (index.html) för /service-worker.js.
//
// Vi har inget faktiskt behov av offline-support — kioskerna behöver
// internet för att skicka svar till Supabase, och admin-vyn ska vara live.
// Genom att anropa unregister() här rensar vi också aktivt bort eventuella
// gamla SWs som registrerades från tidigare bundles.
//
// Filen serviceWorkerRegistration.js behålls om vi senare vill bygga en
// riktig SW med Workbox för offline-svarsbufferting (egen sprint).
serviceWorkerRegistration.unregister();

reportWebVitals();
