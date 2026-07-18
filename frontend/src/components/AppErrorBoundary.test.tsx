import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';


it('recovers from a transient render failure', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  let shouldThrow = true;
  const FlakyChild = () => {
    if (shouldThrow) throw new Error('transient failure');
    return <p>Recovered content</p>;
  };

  render(
    <AppErrorBoundary>
      <FlakyChild />
    </AppErrorBoundary>,
  );

  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  shouldThrow = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Recovered content')).toBeInTheDocument();

  consoleError.mockRestore();
});