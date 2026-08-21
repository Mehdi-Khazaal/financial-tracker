import React from 'react';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import { useSettingsModel } from '../features/settings/useSettingsModel';
import { useIsDesktop } from '../features/settings/hooks/useIsDesktop';
import {
  SettingsBackButton,
  SettingsRail,
  SettingsSectionList,
} from '../features/settings/components/SettingsNav';
import PlaidLinkLauncher from '../features/settings/components/PlaidLinkLauncher';
import AccountSection from '../features/settings/sections/AccountSection';
import PreferencesSection from '../features/settings/sections/PreferencesSection';
import CategoriesSection from '../features/settings/sections/CategoriesSection';
import ConnectionsSection from '../features/settings/sections/ConnectionsSection';
import AdminSection from '../features/settings/sections/AdminSection';
import type { SettingsSection } from '../features/settings/types';

/**
 * Settings — a control centre, not a scroll.
 *
 * This page used to be 649 lines holding six unrelated concerns in one column,
 * which on a phone meant the category list pushed Connections and Admin
 * thousands of pixels below the fold, and on a 1440px display left more than
 * half the viewport empty beside a 672px column.
 *
 * It now orchestrates and nothing else: `useSettingsModel` owns the data and
 * the section state, each section owns its own markup, and this file decides
 * only which one is on screen. Behaviour is deliberately unchanged — Phase 6A
 * is architecture, and 6B/6C own the Category Manager and Connections redesign.
 *
 * The two layouts share one piece of state rather than duplicating it. Mobile
 * treats "no section chosen" as the list; desktop substitutes the default so
 * the content pane is never blank. Only one layout is rendered at a time —
 * see `useIsDesktop` for why that is a media query rather than a CSS toggle.
 */

const SECTION_TITLES: Record<SettingsSection, string> = {
  account: 'Account',
  preferences: 'Preferences',
  categories: 'Categories',
  connections: 'Connections',
  admin: 'Admin',
};

const Settings: React.FC = () => {
  const model = useSettingsModel();
  const isDesktop = useIsDesktop();

  const renderSection = (section: SettingsSection) => {
    switch (section) {
      case 'account':
        return (
          <AccountSection
            username={model.username}
            email={model.email}
            onSignOut={model.signOut}
          />
        );
      case 'preferences':
        return <PreferencesSection push={model.push} />;
      case 'categories':
        return <CategoriesSection categories={model.categories} />;
      case 'connections':
        return <ConnectionsSection connections={model.connections} />;
      case 'admin':
        // Belt and braces: the rail never offers this to a non-admin and
        // `resolvedSection` cannot return it, but the switch should not be the
        // only thing standing between a non-admin and admin markup.
        return model.isAdmin ? <AdminSection admin={model.admin} /> : null;
      default:
        return null;
    }
  };

  return (
    <AppShell>
      <PageLayout>
        <div className="settings-page px-4 md:px-6 pt-6 md:pt-8 pb-10 fade-in">
          {isDesktop ? (
            <>
              <div className="product-page-header topbar-safe">
                <h1 className="product-page-title">Settings</h1>
              </div>
              <div className="settings-shell mt-6">
                <aside className="settings-shell__nav">
                  <SettingsRail
                    sections={model.sections}
                    active={model.resolvedSection}
                    onSelect={model.selectSection}
                  />
                </aside>
                <div className="settings-shell__content">
                  {renderSection(model.resolvedSection)}
                </div>
              </div>
            </>
          ) : model.activeSection === null ? (
            <>
              <div className="product-page-header topbar-safe">
                <h1 className="product-page-title">Settings</h1>
              </div>
              <div className="mt-4">
                <SettingsSectionList
                  sections={model.sections}
                  active={model.activeSection}
                  onSelect={model.selectSection}
                  summaries={model.summaries}
                />
              </div>
            </>
          ) : (
            <>
              <div className="topbar-safe">
                <SettingsBackButton onBack={model.clearSection} />
              </div>
              <h1 className="product-page-title mt-2 mb-4">
                {SECTION_TITLES[model.resolvedSection]}
              </h1>
              {renderSection(model.resolvedSection)}
            </>
          )}
        </div>
      </PageLayout>

      {/* Mounted only while a Link flow is open, in either mode. Loading
          `usePlaidLink` at page mount pulls Plaid's CDN script and a persistent
          preload iframe, which breaks PWA rendering on iOS/Android — see
          PlaidLinkLauncher.

          The success branch differs by mode and must not be unified: a new
          connection exchanges its public token, a repair must not, because
          update mode reuses the existing Item and its access token. */}
      {model.connections.linkFlow && (
        <PlaidLinkLauncher
          mode={model.connections.linkFlow.mode}
          itemId={model.connections.linkFlow.itemId}
          onSuccess={(publicToken, metadata) => {
            const flow = model.connections.linkFlow;
            if (flow?.mode === 'update' && flow.itemId != null) {
              void model.connections.onRepaired(flow.itemId);
              return;
            }
            void model.connections.onConnected(publicToken, metadata?.institution?.name);
          }}
          onExit={model.connections.onConnectCancelled}
          onError={model.connections.onConnectError}
        />
      )}
    </AppShell>
  );
};

export default Settings;
