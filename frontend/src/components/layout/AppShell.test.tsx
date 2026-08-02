import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppShell, PageLayout } from './AppShell';
import { CONTEXT_TABS, hasContextTabs } from './routeLayout';

/**
 * Mobile fixed-control spacing.
 *
 * Two bars float over the page on a phone — the context tabs and the dock —
 * and the only thing keeping the last card clear of them is the reserve
 * attribute the shell stamps on itself. It is easy to break by adding a route
 * and forgetting its tabs, so it is asserted rather than assumed.
 */

let mockPathname = '/';

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
}));

jest.mock('../Navigation', () => () => null);

describe('AppShell mobile bottom reserve', () => {
  const renderShell = (path: string) => {
    mockPathname = path;
    return render(
      <AppShell>
        <PageLayout>
          <p>content</p>
        </PageLayout>
      </AppShell>,
    );
  };

  it('reserves room for the context tabs and the dock on the dashboard', () => {
    const { container } = renderShell('/');

    expect(container.querySelector('.app-shell'))
      .toHaveAttribute('data-mobile-reserve', 'context-tabs');
  });

  it('reserves room for the dock alone on a route without context tabs', () => {
    const { container } = renderShell('/settings');

    expect(container.querySelector('.app-shell'))
      .toHaveAttribute('data-mobile-reserve', 'dock');
  });

  it('uses the document scroll region by default, which carries the padding', () => {
    renderShell('/');

    const main = screen.getByRole('main');
    expect(main).toHaveClass('app-page-layout--document');
    expect(main).toHaveAttribute('data-scroll-region', 'document');
  });

  it('keeps the dashboard Overview/Analytics switch registered', () => {
    expect(hasContextTabs('/')).toBe(true);
    expect(CONTEXT_TABS['/'].map(t => t.value)).toEqual(['overview', 'analytics']);
  });
});
