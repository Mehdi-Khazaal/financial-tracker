import React from 'react';
import { useLocation } from 'react-router-dom';
import Navigation from '../Navigation';
import './AppShell.css';
import { hasContextTabs } from './routeLayout';

export interface AppShellProps {
  children: React.ReactNode;
  className?: string;
}

export type PageScrollRegion = 'document' | 'contained';

export interface PageLayoutProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  scrollRegion?: PageScrollRegion;
}

const joinClassNames = (...classNames: Array<string | undefined>): string =>
  classNames.filter(Boolean).join(' ');

export const AppShell: React.FC<AppShellProps> = ({ children, className }) => {
  const { pathname } = useLocation();

  return (
    <div
      className={joinClassNames('app-shell', className)}
      data-mobile-reserve={hasContextTabs(pathname) ? 'context-tabs' : 'dock'}
    >
      <Navigation />
      {children}
    </div>
  );
};

export const PageLayout = React.forwardRef<HTMLElement, PageLayoutProps>(
  ({ children, className, scrollRegion = 'document', ...props }, ref) => (
    <main
      {...props}
      ref={ref}
      className={joinClassNames(
        'app-page-layout',
        `app-page-layout--${scrollRegion}`,
        className,
      )}
      data-scroll-region={scrollRegion}
    >
      {children}
    </main>
  ),
);

PageLayout.displayName = 'PageLayout';
