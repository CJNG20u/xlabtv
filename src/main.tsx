import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PhoneRemoteApp } from './remote/PhoneRemoteApp.tsx';
import './index.css';

const isRemoteRoute = window.location.pathname.startsWith('/remote');

if (isRemoteRoute) {
  document.documentElement.classList.add('remote-mode');
  document.title = 'xLab Remote';
} else {
  document.documentElement.classList.remove('remote-mode');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isRemoteRoute ? <PhoneRemoteApp /> : <App />}</StrictMode>
);
