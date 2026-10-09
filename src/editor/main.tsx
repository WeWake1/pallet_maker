import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { isPhone, thisDevice } from './device.js';
import { MobileNotice } from './MobileNotice.jsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root in the page');

createRoot(root).render(
  <StrictMode>{isPhone(thisDevice()) ? <MobileNotice /> : <App />}</StrictMode>,
);
