import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './components/App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const root = document.getElementById('root')!;
root.innerHTML = '<div style="padding:12px">Загрузка...</div>';

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} catch (e: any) {
  root.innerHTML = '<div style="color:red;padding:12px">' + String(e?.message || e) + '</div>';
}
