import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './features/app/AppProviders';
import { AppRouter } from './features/app/AppRouter';

function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </BrowserRouter>
  );
}

export default App;
