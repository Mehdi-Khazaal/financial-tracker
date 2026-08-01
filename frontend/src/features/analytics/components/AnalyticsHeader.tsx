import React, { useEffect, useRef, useState } from 'react';
import type { PeriodId, ResolvedPeriod } from '../types';
import { PERIOD_OPTIONS } from '../period';
import { monthLabel, shortMonthLabel } from '../format';

interface Props {
  periodId: PeriodId;
  customMonth: string;
  availableMonths: string[];
  period: ResolvedPeriod;
  onPeriodChange: (id: PeriodId) => void;
  onCustomMonthChange: (month: string) => void;
  onExportCsv: () => void;
  onExportPrint: () => void;
}

/**
 * Period controls. These drive every section on the page — there is no
 * component left that quietly reads "this month" regardless of what is
 * selected here.
 */
const AnalyticsHeader: React.FC<Props> = ({
  periodId, customMonth, availableMonths, period,
  onPeriodChange, onCustomMonthChange, onExportCsv, onExportPrint,
}) => {
  const [monthOpen, setMonthOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const monthRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!monthOpen && !exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (monthRef.current && !monthRef.current.contains(e.target as Node)) setMonthOpen(false);
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMonthOpen(false); setExportOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [monthOpen, exportOpen]);

  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div
        className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
        role="group"
        aria-label="Select the period to analyse"
      >
        {PERIOD_OPTIONS.map(option => {
          const active = periodId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onPeriodChange(option.id)}
              aria-pressed={active}
              className="pill min-h-[44px] shrink-0 pressable transition-all"
              style={active
                ? { backgroundColor: 'oklch(72% 0.17 55 / 0.15)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.3)' }
                : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px solid transparent' }}
            >
              {option.id === 'custom' && active ? shortMonthLabel(customMonth) : option.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {periodId === 'custom' && (
          <div ref={monthRef} className="relative">
            <button
              type="button"
              onClick={() => setMonthOpen(v => !v)}
              className="header-action text-sm"
              aria-haspopup="listbox"
              aria-expanded={monthOpen}
              aria-label={`Change month, currently ${monthLabel(customMonth)}`}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
                className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M13.25 3v2.25M3 8.25h14M5.25 3.75h9.5A2.25 2.25 0 0117 6v10.5A2.25 2.25 0 0114.75 18.75H5.25A2.25 2.25 0 013 16.5V6A2.25 2.25 0 015.25 3.75z" />
              </svg>
              <span>{monthLabel(customMonth)}</span>
            </button>
            {monthOpen && availableMonths.length > 0 && (
              <div
                className="menu-surface absolute top-full right-0 mt-1.5 min-w-[180px] py-1 max-h-64 overflow-y-auto"
                role="listbox"
                aria-label="Analytics month"
              >
                {availableMonths.map(month => (
                  <button
                    key={month}
                    type="button"
                    role="option"
                    aria-selected={month === customMonth}
                    onClick={() => { onCustomMonthChange(month); setMonthOpen(false); }}
                    className="menu-item justify-between text-sm font-medium w-full"
                    style={month === customMonth
                      ? { backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }
                      : { color: 'var(--fg)' }}
                  >
                    {monthLabel(month)}
                    {month === customMonth && (
                      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5 shrink-0">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={exportRef} className="relative">
          <button
            type="button"
            onClick={() => setExportOpen(v => !v)}
            className="header-action text-sm"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5 shrink-0">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <span>Export</span>
          </button>
          {exportOpen && (
            <div className="menu-surface absolute top-full right-0 mt-1.5 min-w-[210px] py-1" role="menu">
              <button
                type="button" role="menuitem" className="menu-item text-sm w-full"
                style={{ color: 'var(--fg)' }}
                onClick={() => { onExportCsv(); setExportOpen(false); }}
              >
                Transactions (CSV)
              </button>
              <button
                type="button" role="menuitem" className="menu-item text-sm w-full"
                style={{ color: 'var(--fg)' }}
                onClick={() => { onExportPrint(); setExportOpen(false); }}
              >
                Period summary (print)
              </button>
            </div>
          )}
        </div>

        <p className="text-xs whitespace-nowrap" style={{ color: 'var(--dim)' }}>
          {period.label}
          {period.isIncomplete && ' · in progress'}
        </p>
      </div>
    </div>
  );
};

export default AnalyticsHeader;
