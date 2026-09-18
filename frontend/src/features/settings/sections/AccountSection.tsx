import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/SettingsPrimitives';
import PasswordSection from './PasswordSection';
import { deleteMyAccount, exportAccountJson, exportTransactionsCsv } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';

/**
 * Account: who you are signed in as, your password, your data, and the way
 * out — the door as well as the exit.
 *
 * Deliberately contains only what exists. There is still no endpoint to
 * change a username or email and no session list, so those do not appear.
 * Export and deletion are real endpoints (`/account/*`) and so they do.
 */

interface Props {
  username: string;
  email: string;
  onSignOut: () => void;
}

/** Save a blob the API returned as a file, using the server's filename. */
function saveBlob(blob: Blob, fallbackName: string, disposition?: string) {
  const match = /filename="([^"]+)"/.exec(disposition || '');
  const name = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const DataSection: React.FC = () => {
  const toast = useToast();
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);

  const run = async (kind: 'json' | 'csv') => {
    setBusy(kind);
    try {
      const res = kind === 'json' ? await exportAccountJson() : await exportTransactionsCsv();
      saveBlob(res.data, kind === 'json' ? 'fintrack-export.json' : 'fintrack-transactions.csv', res.headers?.['content-disposition']);
      toast.success(kind === 'json' ? 'Export ready' : 'CSV ready');
    } catch {
      toast.error('The export could not be prepared. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card p-5" aria-labelledby="settings-data-heading">
      <h2 className="label mb-1" id="settings-data-heading">Your data</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Everything Fintrack holds about you, in a file you keep. JSON has every record; CSV is your transactions for a spreadsheet.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-ghost pressable" style={{ minHeight: 44 }} onClick={() => { void run('json'); }} disabled={busy !== null}>
          {busy === 'json' ? 'Preparing…' : 'Export JSON'}
        </button>
        <button type="button" className="btn-ghost pressable" style={{ minHeight: 44 }} onClick={() => { void run('csv'); }} disabled={busy !== null}>
          {busy === 'csv' ? 'Preparing…' : 'Export CSV'}
        </button>
      </div>
    </section>
  );
};

const DeleteSection: React.FC = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      toast.error('Type DELETE to confirm');
      return;
    }
    setLoading(true);
    try {
      const res = await deleteMyAccount(password, confirmation);
      if (res.data.bank_connections_unremoved > 0) {
        toast.info('Your account is deleted. One bank connection could not be removed at Plaid; it will expire on its own.');
      } else {
        toast.success('Your account and all of its data have been deleted.');
      }
      await logout();
      navigate('/', { replace: true });
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'The account could not be deleted.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card p-5" aria-labelledby="settings-delete-heading" style={{ borderColor: 'rgba(239,68,68,0.25)' }}>
      <h2 className="label mb-1" id="settings-delete-heading" style={{ color: 'var(--neg)' }}>Delete account</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Removes your bank connections at Plaid, your devices, and every record — immediately and permanently. Export first if you want to keep anything.
      </p>
      {!open ? (
        <button type="button" className="btn-danger pressable w-full" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>
          Delete my account…
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3" aria-label="Confirm account deletion">
          <div>
            <label className="label mb-2 block" htmlFor="delete-password">Your password</label>
            <input id="delete-password" type="password" className="input-dark" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <label className="label mb-2 block" htmlFor="delete-confirm">Type DELETE to confirm</label>
            <input id="delete-confirm" type="text" className="input-dark font-mono tracking-widest" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-ghost pressable" style={{ minHeight: 44 }} onClick={() => { setOpen(false); setPassword(''); setConfirmation(''); }} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-danger pressable" style={{ minHeight: 44 }} disabled={loading}>
              {loading ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

const AccountSection: React.FC<Props> = ({ username, email, onSignOut }) => (
  <div className="space-y-6">
    <section className="card p-5" aria-labelledby="settings-profile-heading">
      <h2 className="label mb-4" id="settings-profile-heading">Profile</h2>
      <div className="flex items-center gap-4">
        <Avatar label={username} size="lg" />
        <div className="min-w-0">
          <p className="font-semibold text-text">{username}</p>
          <p className="text-sm text-muted break-all">{email}</p>
        </div>
      </div>
      <button
        onClick={onSignOut}
        className="mt-4 w-full min-h-[44px] py-2.5 text-sm font-semibold rounded-xl transition-all"
        style={{
          backgroundColor: 'oklch(70% 0.17 25 / 0.08)',
          color: 'var(--neg)',
          border: '1px solid oklch(70% 0.17 25 / 0.15)',
        }}
      >
        Sign out
      </button>
    </section>

    <PasswordSection />
    <DataSection />
    <DeleteSection />

    <p className="label flex gap-4 px-1" style={{ color: 'var(--dim)' }}>
      <Link to="/privacy" style={{ color: 'var(--muted)' }}>Privacy</Link>
      <Link to="/terms" style={{ color: 'var(--muted)' }}>Terms</Link>
    </p>
  </div>
);

export default AccountSection;
