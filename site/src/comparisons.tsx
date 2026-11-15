import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Comparisons from './components/Comparisons.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Comparisons />
  </StrictMode>,
);
