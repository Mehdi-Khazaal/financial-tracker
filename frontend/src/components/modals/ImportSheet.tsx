import React, { useEffect, useMemo, useRef, useState } from 'react';
import BottomSheet from '../BottomSheet';
import type { Account, ImportPreview, ImportRequest, ImportResult } from '../../types';
import { importTransactions, previewImport, undoImport } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { dollars } from '../../features/analytics/format';

/**
 * Import a bank's CSV export.
 *
 * Three moments, one sheet: pick the file and the account; check the
 * mapping and the preview the server built from it (what it could not read,
 * what it already has); import. Nothing is written until the last button,
 * and the result offers an undo for the whole batch.
 *
 * The file is read in the browser and sent as text inside JSON, so the
 * request goes through the same idempotency and offline machinery as every
 * other write — a retry after a dropped connection cannot import twice.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  accounts: Account[];
}

type Mapping = ImportPreview['mapping'];
const MAPPED_FIELDS: { key: keyof Mapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'amount', label: 'Amount' },
  { key: 'debit', label: 'Money out (debit)' },
  { key: 'credit', label: 'Money in (credit)' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
];
const MAX_FILE_BYTES = 400 * 1024;

const ImportSheet: React.FC<Props> = ({ isOpen, onClose, onImported, accounts }) => {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [dateFormat, setDateFormat] = useState<ImportRequest['date_format']>('auto');
  const [flipSign, setFlipSign] = useState(false);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Bumped after an undo so the preview is asked again against the ledger
  // as it now stands, rather than trusting counts from before the import.
  const [previewNonce, setPreviewNonce] = useState(0);

  // Reset on open only. The page reloads its accounts after an import, and
  // resetting on that new array wiped the result — and its Undo — the moment
  // the import finished.
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  useEffect(() => {
    if (!isOpen) return;
    setText(''); setFileName(''); setMapping(null); setPreview(null); setError(null); setResult(null);
    setFlipSign(false); setIncludeDuplicates(false); setDateFormat('auto');
    const list = accountsRef.current;
    setAccountId(list.length === 1 ? String(list[0].id) : '');
  }, [isOpen]);

  // Accounts can arrive after the sheet opened (a deep link on a cold load).
  useEffect(() => {
    if (!isOpen || accountId || accounts.length !== 1) return;
    setAccountId(String(accounts[0].id));
  }, [isOpen, accounts, accountId]);

  const request = useMemo<ImportRequest | null>(() => {
    if (!text || !accountId) return null;
    return { account_id: Number(accountId), text, mapping: mapping ?? undefined, date_format: dateFormat, flip_sign: flipSign, include_duplicates: includeDuplicates };
  }, [text, accountId, mapping, dateFormat, flipSign, includeDuplicates]);

  // Preview whenever the inputs change; stale answers are dropped.
  const requestId = useRef(0);
  useEffect(() => {
    if (!request || !isOpen) return;
    const id = ++requestId.current;
    setBusy(true);
    previewImport(request)
      .then(res => {
        if (id !== requestId.current) return;
        const data = res.data as ImportPreview;
        setPreview(data);
        setError(null);
        if (!mapping) setMapping(data.mapping);
      })
      .catch(err => {
        if (id !== requestId.current) return;
        setPreview(null);
        const detail = err?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : 'The file could not be read');
      })
      .finally(() => { if (id === requestId.current) setBusy(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, isOpen, previewNonce]);

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError(`That file is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_FILE_BYTES / 1024} KB.`); return; }
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result ?? '')); setFileName(file.name); setMapping(null); setResult(null); };
    reader.onerror = () => setError('The file could not be read');
    reader.readAsText(file);
  };

  const runImport = async () => {
    if (!request) return;
    setBusy(true);
    try {
      const res = await importTransactions(request);
      const data = res.data as ImportResult;
      setResult(data);
      toast.success(data.created === 0 ? 'Nothing new to import' : `${data.created} transaction${data.created === 1 ? '' : 's'} imported`);
      onImported();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'The import failed; nothing was written');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await undoImport(result.batch_id);
      toast.success('Import undone');
      setResult(null);
      setPreviewNonce(n => n + 1);
      onImported();
    } catch {
      toast.error('The import could not be undone');
    } finally {
      setBusy(false);
    }
  };

  const importable = preview ? preview.valid - (includeDuplicates ? 0 : preview.duplicates) : 0;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Import CSV" size="lg">
      <div className="px-5 pb-6 space-y-4">
        {result ? (
          <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }} role="status">
            <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
              {result.created} imported
              {result.skipped_duplicates > 0 && <span style={{ color: 'var(--muted)' }}> · {result.skipped_duplicates} already there</span>}
              {result.skipped_invalid > 0 && <span style={{ color: 'var(--muted)' }}> · {result.skipped_invalid} unreadable</span>}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost pressable px-3 text-xs" style={{ minHeight: 44 }} onClick={() => { void undo(); }} disabled={busy || result.created === 0}>
                Undo this import
              </button>
              <button type="button" className="btn-gradient pressable px-3 text-xs" style={{ minHeight: 44 }} onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label mb-2 block" htmlFor="import-file">File</label>
                <input ref={fileRef} id="import-file" type="file" accept=".csv,text/csv,text/plain" onChange={pickFile} className="sr-only" />
                <button type="button" className="btn-ghost pressable w-full text-left truncate px-3" style={{ minHeight: 44 }} onClick={() => fileRef.current?.click()}>
                  {fileName || 'Choose a CSV…'}
                </button>
              </div>
              <div>
                <label className="label mb-2 block" htmlFor="import-account">Into account</label>
                <select id="import-account" value={accountId} onChange={e => setAccountId(e.target.value)} className="input-dark w-full" required>
                  <option value="">Choose an account</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            {preview && mapping && (
              <>
                <div>
                  <p className="label mb-2">Columns</p>
                  <div className="grid grid-cols-2 gap-2">
                    {MAPPED_FIELDS.map(field => (
                      <label key={field.key} className="text-xs" style={{ color: 'var(--muted)' }}>
                        <span className="block mb-1">{field.label}{field.required ? ' *' : ''}</span>
                        <select
                          aria-label={`${field.label} column`}
                          value={mapping[field.key] ?? ''}
                          onChange={e => setMapping({ ...mapping, [field.key]: e.target.value || null })}
                          className="input-dark w-full text-sm"
                        >
                          <option value="">—</option>
                          {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs" style={{ color: 'var(--muted)' }}>
                    <span className="block mb-1">Date order</span>
                    <select value={dateFormat} onChange={e => setDateFormat(e.target.value as ImportRequest['date_format'])} className="input-dark w-full text-sm" aria-label="Date order">
                      <option value="auto">Detect</option>
                      <option value="ymd">Year-month-day</option>
                      <option value="mdy">Month/day/year</option>
                      <option value="dmy">Day/month/year</option>
                    </select>
                  </label>
                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)', minHeight: 44 }}>
                      <input type="checkbox" checked={flipSign} onChange={e => setFlipSign(e.target.checked)} className="w-4 h-4" />
                      Money out is shown as positive in this file
                    </label>
                    {preview.duplicates > 0 && (
                      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)', minHeight: 44 }}>
                        <input type="checkbox" checked={includeDuplicates} onChange={e => setIncludeDuplicates(e.target.checked)} className="w-4 h-4" />
                        Import the {preview.duplicates} that look already recorded
                      </label>
                    )}
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }} aria-live="polite">
                  <p className="text-sm" style={{ color: 'var(--fg)' }}>
                    <span className="font-mono tabular-nums">{preview.total}</span> rows ·{' '}
                    <span className="font-mono tabular-nums">{importable}</span> to import
                    {preview.duplicates > 0 && !includeDuplicates && <> · <span className="font-mono tabular-nums">{preview.duplicates}</span> already recorded</>}
                    {preview.invalid > 0 && <> · <span className="font-mono tabular-nums" style={{ color: 'var(--neg)' }}>{preview.invalid}</span> unreadable</>}
                  </p>
                  <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto app-scrollbar" aria-label="Preview rows">
                    {preview.sample.slice(0, 12).map(row => (
                      <li key={row.row_number} className="flex items-center justify-between gap-2 text-xs" style={{ opacity: row.errors.length || row.duplicate ? 0.6 : 1 }}>
                        <span className="font-mono tabular-nums shrink-0 w-20" style={{ color: 'var(--dim)' }}>{row.date ?? '—'}</span>
                        <span className="truncate flex-1" style={{ color: 'var(--fg)' }}>{row.description || '—'}</span>
                        <span className="shrink-0 text-[10px]" style={{ color: row.errors.length ? 'var(--neg)' : 'var(--dim)' }}>
                          {row.errors.length ? row.errors.join(', ') : row.duplicate ? 'already recorded' : row.category_name && !row.category_id ? 'category not found' : ''}
                        </span>
                        <span className="font-mono tabular-nums shrink-0" style={{ color: row.amount != null && Number(row.amount) < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                          {row.amount != null ? dollars(Number(row.amount)) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {error && <p className="text-xs" role="alert" style={{ color: 'var(--neg)' }}>{error}</p>}
            {!preview && !error && text && busy && <p className="text-xs" style={{ color: 'var(--dim)' }}>Checking the file…</p>}

            <button type="button" className="btn-gradient pressable w-full" style={{ minHeight: 44 }} onClick={() => { void runImport(); }} disabled={busy || !preview || importable === 0 || !mapping?.date}>
              {busy ? 'Working…' : importable > 0 ? `Import ${importable} transaction${importable === 1 ? '' : 's'}` : 'Nothing to import'}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
};

export default ImportSheet;
