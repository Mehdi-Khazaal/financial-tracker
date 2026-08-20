import React from 'react';
import { SECTION_DEFINITIONS, type SettingsSection } from '../types';

/**
 * Section navigation, in the two shapes Settings needs.
 *
 * Desktop gets a rail beside the content; mobile gets a list that *is* the
 * page until a section is chosen. Both read the same `SECTION_DEFINITIONS` and
 * drive the same state, so there is one idea of what a section is rather than
 * two that can drift.
 *
 * Rendered as a `<nav>` with a real list. The desktop rail marks the open
 * section with `aria-current="page"` rather than colour alone, which is the
 * only cue a screen reader or a monochrome display would otherwise get.
 */

interface Props {
  sections: readonly typeof SECTION_DEFINITIONS[number][];
  active: SettingsSection | null;
  onSelect: (section: SettingsSection) => void;
  /** Optional right-hand summary per section, e.g. "22 categories". */
  summaries?: Partial<Record<SettingsSection, string>>;
}

export const SettingsRail: React.FC<Props> = ({ sections, active, onSelect }) => (
  <nav aria-label="Settings sections" className="settings-rail">
    <ul className="flex flex-col gap-0.5">
      {sections.map(section => {
        const isActive = section.id === active;
        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onSelect(section.id)}
              aria-current={isActive ? 'page' : undefined}
              className="w-full text-left min-h-[44px] px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={isActive
                ? { backgroundColor: 'var(--elev-2)', color: 'var(--fg)' }
                : { color: 'var(--muted)' }}
            >
              {section.label}
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
);

export const SettingsSectionList: React.FC<Props> = ({ sections, onSelect, summaries }) => (
  <nav aria-label="Settings sections">
    <ul className="card overflow-hidden">
      {sections.map((section, index) => (
        <li key={section.id}>
          <button
            type="button"
            onClick={() => onSelect(section.id)}
            className="w-full text-left px-4 py-3.5 min-h-[44px] flex items-center gap-3 transition-colors"
            style={{ borderBottom: index < sections.length - 1 ? '1px solid var(--line)' : 'none' }}
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-text">{section.label}</span>
              <span className="block text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
                {summaries?.[section.id] ?? section.description}
              </span>
            </span>
            {/* Decorative: the button's own text is the accessible name. */}
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="w-4 h-4 shrink-0" style={{ color: 'var(--dim)' }} aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  </nav>
);

/** Mobile-only return path out of a section, back to the list. */
export const SettingsBackButton: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <button
    type="button"
    onClick={onBack}
    className="min-h-[44px] -ml-1 px-1 inline-flex items-center gap-1.5 text-sm font-semibold"
    style={{ color: 'var(--muted)' }}
  >
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className="w-4 h-4" aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
    Settings
  </button>
);
