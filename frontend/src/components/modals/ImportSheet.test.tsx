import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImportSheet from './ImportSheet';
import { importTransactions, previewImport, undoImport } from '../../utils/api';
import type { Account, ImportPreview } from '../../types';

const { mockSuccess, mockError } = vi.hoisted(() => ({ mockSuccess: vi.fn(), mockError: vi.fn() }));

vi.mock('../../utils/api', () => ({
  __esModule: true,
  previewImport: vi.fn(),
  importTransactions: vi.fn(),
  undoImport: vi.fn(),
}));
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ error: mockError, success: mockSuccess, info: vi.fn(), confirm: vi.fn() }),
}));

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Checking', type: 'checking', balance: 100, currency: 'USD', created_at: '', updated_at: '' } as Account,
];
const CSV = 'Date,Description,Amount\n2026-03-01,NETFLIX.COM,-15.99\n2026-03-02,Salary,3000\n';
const preview: ImportPreview = {
  headers: ['Date', 'Description', 'Amount'],
  mapping: { date: 'Date', amount: 'Amount', description: 'Description', category: null, debit: null, credit: null },
  total: 2, valid: 2, invalid: 0, duplicates: 1,
  sample: [
    { row_number: 2, date: '2026-03-01', amount: '-15.99', description: 'NETFLIX.COM', category_name: '', category_id: null, errors: [], duplicate: true },
    { row_number: 3, date: '2026-03-02', amount: '3000.00', description: 'Salary', category_name: '', category_id: null, errors: [], duplicate: false },
  ],
};

const chooseFile = async () => {
  const input = document.getElementById('import-file') as HTMLInputElement;
  const file = new File([CSV], 'export.csv', { type: 'text/csv' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(previewImport).toHaveBeenCalled());
};

beforeEach(() => {
  (previewImport as Mock).mockResolvedValue({ data: preview });
  (importTransactions as Mock).mockResolvedValue({ data: { batch_id: 'abc', created: 1, skipped_duplicates: 1, skipped_invalid: 0 } });
  (undoImport as Mock).mockResolvedValue({ data: { removed: 1 } });
});

describe('ImportSheet', () => {
  it('reads the file, previews it with the account preselected, and reports what will be imported', async () => {
    render(<ImportSheet isOpen onClose={vi.fn()} onImported={vi.fn()} accounts={accounts} />);
    await chooseFile();
    expect(previewImport).toHaveBeenCalledWith(expect.objectContaining({ account_id: 1, text: CSV, date_format: 'auto', flip_sign: false }));
    expect(await screen.findByText('export.csv')).toBeInTheDocument();
    expect(screen.getByLabelText('Date column')).toHaveValue('Date');
    expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument();
    expect(screen.getByText('already recorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 transaction' })).toBeEnabled();
  });

  it('re-previews when the mapping or sign option changes, and sends the mapping on import', async () => {
    const onImported = vi.fn();
    render(<ImportSheet isOpen onClose={vi.fn()} onImported={onImported} accounts={accounts} />);
    await chooseFile();
    await screen.findByText('export.csv');
    fireEvent.change(screen.getByLabelText('Description column'), { target: { value: 'Date' } });
    await waitFor(() => expect(previewImport).toHaveBeenCalledWith(expect.objectContaining({ mapping: expect.objectContaining({ description: 'Date' }) })));
    fireEvent.click(screen.getByLabelText(/Money out is shown as positive/));
    await waitFor(() => expect(previewImport).toHaveBeenCalledWith(expect.objectContaining({ flip_sign: true })));

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 transaction' }));
    await waitFor(() => expect(importTransactions).toHaveBeenCalledWith(expect.objectContaining({ flip_sign: true, include_duplicates: false })));
    expect(await screen.findByRole('status')).toHaveTextContent('1 imported · 1 already there');
    expect(onImported).toHaveBeenCalled();
    expect(mockSuccess).toHaveBeenCalledWith('1 transaction imported');

    fireEvent.click(screen.getByRole('button', { name: 'Undo this import' }));
    await waitFor(() => expect(undoImport).toHaveBeenCalledWith('abc'));
    expect(mockSuccess).toHaveBeenCalledWith('Import undone');
  });

  it('keeps the result and its undo when the page reloads its accounts after the import', async () => {
    const { rerender } = render(<ImportSheet isOpen onClose={vi.fn()} onImported={vi.fn()} accounts={accounts} />);
    await chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 transaction' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 imported');
    // The page's reload hands the sheet a new array with the same accounts.
    rerender(<ImportSheet isOpen onClose={vi.fn()} onImported={vi.fn()} accounts={accounts.map(a => ({ ...a, balance: 200 }))} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 imported');
    expect(screen.getByRole('button', { name: 'Undo this import' })).toBeEnabled();
  });

  it('asks for a fresh preview after an undo', async () => {
    render(<ImportSheet isOpen onClose={vi.fn()} onImported={vi.fn()} accounts={accounts} />);
    await chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 transaction' }));
    const before = (previewImport as Mock).mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Undo this import' }));
    await waitFor(() => expect((previewImport as Mock).mock.calls.length).toBe(before + 1));
  });

  it('shows the server reason when the file cannot be used', async () => {
    (previewImport as Mock).mockRejectedValue({ response: { data: { detail: 'The first line must name the columns' } } });
    render(<ImportSheet isOpen onClose={vi.fn()} onImported={vi.fn()} accounts={accounts} />);
    await chooseFile();
    expect(await screen.findByRole('alert')).toHaveTextContent('The first line must name the columns');
    expect(screen.getByRole('button', { name: 'Nothing to import' })).toBeDisabled();
  });
});
