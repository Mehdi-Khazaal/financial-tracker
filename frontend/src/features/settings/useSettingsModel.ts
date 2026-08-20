import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDeepLinkParams } from '../../hooks/useDeepLinkParams';
import { DEEP_LINK_KEYS } from '../../lib/deepLinks';
import { useCategories, type UseCategories } from './hooks/useCategories';
import { usePlaidConnections, type UsePlaidConnections } from './hooks/usePlaidConnections';
import { usePushPreference, type UsePushPreference } from './hooks/usePushPreference';
import { useAdminUsers, type UseAdminUsers } from './hooks/useAdminUsers';
import {
  DEFAULT_SECTION,
  SECTION_DEFINITIONS,
  canSeeSection,
  resolveSection,
  type SectionDefinition,
  type SettingsSection,
} from './types';

export interface SettingsModel {
  username: string;
  email: string;
  isAdmin: boolean;
  signOut: () => void;

  /**
   * The open section, or null meaning "no section chosen yet".
   *
   * One piece of state serves both layouts. Null is meaningful on mobile — it
   * is the section list, which *is* the page until something is picked — and
   * meaningless on desktop, where `resolvedSection` substitutes the default so
   * the content pane is never blank.
   */
  activeSection: SettingsSection | null;
  resolvedSection: SettingsSection;
  selectSection: (section: SettingsSection) => void;
  clearSection: () => void;

  /** Sections this user may open, in order. */
  sections: readonly SectionDefinition[];
  /** Live one-liners for the mobile list, falling back to static descriptions. */
  summaries: Partial<Record<SettingsSection, string>>;

  categories: UseCategories;
  connections: UsePlaidConnections;
  push: UsePushPreference;
  admin: UseAdminUsers;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function useSettingsModel(): SettingsModel {
  const { user, logout } = useAuth();
  const isAdmin = !!user?.is_admin;

  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);

  const categories = useCategories();
  const connections = usePlaidConnections();
  const push = usePushPreference();
  const admin = useAdminUsers(isAdmin);

  // Same convention every other route uses: apply the arriving parameter once,
  // then strip it, so the URL never lingers describing a section the user has
  // since navigated away from. An unknown value — or `admin` for a non-admin —
  // resolves to null and simply leaves the user where they were.
  useDeepLinkParams(params => {
    const requested = resolveSection(params.get(DEEP_LINK_KEYS.tab), isAdmin);
    if (requested) setActiveSection(requested);
  });

  const sections = useMemo(
    () => SECTION_DEFINITIONS.filter(section => canSeeSection(section.id, isAdmin)),
    [isAdmin],
  );

  const summaries = useMemo<Partial<Record<SettingsSection, string>>>(() => {
    const result: Partial<Record<SettingsSection, string>> = {};
    if (categories.status === 'ready') {
      result.categories = plural(categories.items.length, 'category').replace('categorys', 'categories');
    }
    if (connections.status === 'ready') {
      result.connections = connections.items.length === 0
        ? 'No banks connected'
        : plural(connections.items.length, 'connected bank');
    }
    return result;
  }, [categories.status, categories.items.length, connections.status, connections.items.length]);

  const selectSection = useCallback((section: SettingsSection) => {
    // Defence in depth: the rail never offers admin to a non-admin, but a
    // caller could still ask for it.
    if (!canSeeSection(section, isAdmin)) return;
    setActiveSection(section);
  }, [isAdmin]);

  const clearSection = useCallback(() => setActiveSection(null), []);

  // Guards a role change mid-session: an admin section left open must not
  // survive losing the role.
  const resolvedSection = activeSection && canSeeSection(activeSection, isAdmin)
    ? activeSection
    : DEFAULT_SECTION;

  return {
    username: user?.username ?? '',
    email: user?.email ?? '',
    isAdmin,
    signOut: logout,
    activeSection,
    resolvedSection,
    selectSection,
    clearSection,
    sections,
    summaries,
    categories,
    connections,
    push,
    admin,
  };
}
