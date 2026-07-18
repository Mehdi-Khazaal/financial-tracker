import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AppProviders } from './features/app/AppProviders';
import { AppRouter } from './features/app/AppRouter';

function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}

export default App;
