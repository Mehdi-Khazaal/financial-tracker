/**
 * Settings sections, and the load-state vocabulary they share.
 *
 * Settings was one page holding six unrelated concerns, which on a phone meant
 * the category list pushed Connections and Admin thousands of pixels below the
 * fold. Naming the sections once — here — lets the desktop rail, the mobile
 * list and the `?tab=` deep link all describe the same thing rather than three
 * parallel ideas of what a "section" is.
 */

import type { Account, Category } from '../../types';

export const SETTINGS_SECTIONS = [
  'account',
  'preferences',
  'categories',
  'connections',
  'admin',
] as const;

export type SettingsSection = typeof SETTINGS_SECTIONS[number];

/** The default landing section, and the fallback for anything unrecognised. */
export const DEFAULT_SECTION: SettingsSection = 'account';

export interface SectionDefinition {
  id: SettingsSection;
  label: string;
  /** One line under the label on the mobile list. Never a count — see `summary`. */
  description: string;
  /** Admin is the only section gated on a role. */
  adminOnly?: boolean;
}

export const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { id: 'account', label: 'Account', description: 'Profile, password and sign out' },
  { id: 'preferences', label: 'Preferences', description: 'Notifications' },
  { id: 'categories', label: 'Categories', description: 'How your spending is filed' },
  { id: 'connections', label: 'Connections', description: 'Connected banks and syncing' },
  { id: 'admin', label: 'Admin', description: 'User management', adminOnly: true },
];

/**
 * Whether a section may render for this user.
 *
 * Applied to navigation *and* to the resolved section, so `?tab=admin` cannot
 * render admin content for a non-admin even though the request never reaches
 * the server. The server is still the real guard — `require_admin` rejects the
 * endpoints regardless — this only stops the shell drawing something the user
 * has no business seeing.
 */
export const canSeeSection = (section: SettingsSection, isAdmin: boolean): boolean =>
  SECTION_DEFINITIONS.find(definition => definition.id === section)?.adminOnly !== true || isAdmin;

/** Narrow an arbitrary query value to a section this user may open. */
export const resolveSection = (
  raw: string | null | undefined,
  isAdmin: boolean,
): SettingsSection | null => {
  if (!raw) return null;
  const match = SETTINGS_SECTIONS.find(section => section === raw);
  if (!match) return null;
  return canSeeSection(match, isAdmin) ? match : null;
};

/**
 * Load states, shared by every section that fetches.
 *
 * Two of the three loaders used to swallow their failures — `plaidGetItems`
 * had a bare `catch {}` and `adminGetUsers` had no catch at all — so a failed
 * request rendered as an empty list. "Nothing connected" and "we could not
 * find out" are different facts and now have different states.
 */
export type LoadStatus = 'loading' | 'ready' | 'error';

export interface AsyncCollection<T> {
  status: LoadStatus;
  items: T[];
  reload: () => void;
}

/** A connected Plaid item, as `GET /plaid/items` returns it. */
export interface PlaidItemSummary {
  id: number;
  institution_name: string | null;
  created_at: string;
}

/** A user row, as `GET /admin/users` returns it. */
export interface AdminUserSummary {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  is_verified: boolean;
}

export type { Account, Category };
