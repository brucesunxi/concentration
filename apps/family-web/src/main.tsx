import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { App } from './App.tsx';
import './style.css';
import './compact.css';
import { shellReady } from './offline-shell.ts';

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
void shellReady();
