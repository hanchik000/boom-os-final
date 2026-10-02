import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './design-system/waiter-pos.css';
import './design-system/cashier-pos.css';
import './design-system/command-center.css';
import './design-system/menu-builder.css';
import './design-system/admin-ui.css';
import './design-system/kitchen.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
