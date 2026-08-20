import React, { useState } from 'react';
import { changePassword } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';

/**
 * Change password.
 *
 * Called "Password", not "Security": it is one control, and a section named
 * for a category it does not fill promises things the app cannot do.
 *
 * Behaviour is carried over unchanged. Worth knowing what the endpoint does,
 * because the UI does not say it: `POST /auth/change-password` increments
 * `session_version`, which signs every *other* device out, and re-issues
 * cookies for this one so the acting session survives.
 */
const PasswordSection: React.FC = () => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await changePassword(currentPw, newPw);
      toast.success('Password changed successfully');
      reset();
      setOpen(false);
    } catch (error: any) {
      toast.error(error.response?.data?.detail ?? 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card p-5">
      <button
        onClick={() => setOpen(value => !value)}
        className="w-full min-h-[44px] flex items-center justify-between"
        aria-expanded={open}
        aria-controls="password-settings-form"
      >
        <span className="label">Password</span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          style={{ color: 'var(--dim)' }} aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <form id="password-settings-form" onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="form-label" htmlFor="current-password">Current password</label>
            <input
              id="current-password" type="password" autoComplete="current-password"
              value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              className="input-dark" placeholder="••••••••" required
            />
          </div>
          <div>
            <label className="form-label" htmlFor="new-password">New password</label>
            <input
              id="new-password" type="password" autoComplete="new-password"
              value={newPw} onChange={e => setNewPw(e.target.value)}
              className="input-dark" placeholder="At least 8 characters" required minLength={8}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password" type="password" autoComplete="new-password"
              value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              className="input-dark" placeholder="••••••••" required
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--dim)' }}>
            Changing your password signs you out on your other devices.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="submit" disabled={loading}
              className="btn-gradient flex-1 min-h-[44px] py-2.5 text-sm disabled:opacity-60"
            >
              {loading ? 'Saving…' : 'Change Password'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="btn-ghost min-h-[44px] px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

export default PasswordSection;
