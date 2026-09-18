import React, { useCallback, useEffect, useState } from 'react';
import {
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
} from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';

/**
 * Two-factor authentication.
 *
 * Off → password → scan (or type) → first code → recovery codes → on.
 * Nothing changes for the account until the first code proves the app has
 * the secret, and the recovery codes are shown exactly once, with copy and
 * download, because the server keeps only their hashes.
 *
 * Turning it off asks for the password *and* a code: someone holding an
 * unlocked session should not be able to remove the second factor with the
 * first one alone.
 */

type Stage =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'off' }
  | { kind: 'password'; purpose: 'setup' | 'codes' }
  | { kind: 'scan'; secret: string; qr: string }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'on'; remaining: number }
  | { kind: 'disable' };

const detail = (error: any, fallback: string): string => {
  const value = error?.response?.data?.detail;
  return typeof value === 'string' ? value : fallback;
};

const Field: React.FC<{
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; autoComplete?: string; inputMode?: 'numeric' | 'text'; autoFocus?: boolean;
}> = ({ id, label, value, onChange, type = 'text', autoComplete, inputMode, autoFocus }) => (
  <div>
    <label className="label mb-2 block" htmlFor={id}>{label}</label>
    <input
      id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
      className="input-dark w-full font-mono" autoComplete={autoComplete} inputMode={inputMode} autoFocus={autoFocus}
    />
  </div>
);

const TwoFactorSection: React.FC = () => {
  const toast = useToast();
  const { refresh } = useAuth();
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getTwoFactorStatus();
      setStage(res.data?.enabled ? { kind: 'on', remaining: Number(res.data.recovery_codes_remaining ?? 0) } : { kind: 'off' });
    } catch {
      setStage({ kind: 'error' });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reset = () => { setPassword(''); setCode(''); setError(null); };

  const submitPassword = async (purpose: 'setup' | 'codes') => {
    setBusy(true); setError(null);
    try {
      if (purpose === 'setup') {
        const res = await startTwoFactorSetup(password);
        setStage({ kind: 'scan', secret: res.data.secret, qr: res.data.qr_svg });
      } else {
        const res = await regenerateRecoveryCodes(password);
        setStage({ kind: 'codes', codes: res.data.recovery_codes });
      }
      setPassword('');
    } catch (e) {
      setError(detail(e, 'That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const res = await enableTwoFactor(code.trim());
      setCode('');
      setStage({ kind: 'codes', codes: res.data.recovery_codes });
      toast.success('Two-factor authentication is on');
      void refresh();
    } catch (e) {
      setError(detail(e, 'That code did not match.'));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true); setError(null);
    try {
      await disableTwoFactor(password, code.trim());
      reset();
      setStage({ kind: 'off' });
      toast.success('Two-factor authentication is off');
      void refresh();
    } catch (e) {
      setError(detail(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Copy failed — write them down instead');
    }
  };

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob([`Fintrack recovery codes\nEach works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fintrack-recovery-codes.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const errorLine = error && <p className="text-xs" role="alert" style={{ color: 'var(--neg)' }}>{error}</p>;

  return (
    <section className="card p-5 space-y-4" aria-labelledby="settings-2fa-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label" id="settings-2fa-heading">Two-factor authentication</h2>
        {(stage.kind === 'on' || stage.kind === 'disable') && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' }}>On</span>
        )}
      </div>

      {stage.kind === 'loading' && <p className="text-sm" style={{ color: 'var(--dim)' }} role="status">Checking…</p>}

      {stage.kind === 'error' && (
        <div className="space-y-2">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>This setting could not be loaded.</p>
          <button type="button" className="btn-ghost pressable px-3 text-xs" style={{ minHeight: 44 }} onClick={() => { setStage({ kind: 'loading' }); void load(); }}>Try again</button>
        </div>
      )}

      {stage.kind === 'off' && (
        <>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Ask for a six-digit code from an authenticator app after your password. Someone with only your password can't get in.
          </p>
          <button type="button" className="btn-gradient pressable w-full" style={{ minHeight: 44 }} onClick={() => { reset(); setStage({ kind: 'password', purpose: 'setup' }); }}>
            Set up two-factor
          </button>
        </>
      )}

      {stage.kind === 'password' && (
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submitPassword(stage.purpose); }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {stage.purpose === 'setup' ? 'Confirm your password to start.' : 'Confirm your password. Your current recovery codes stop working.'}
          </p>
          <Field id="twofa-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          {errorLine}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost pressable flex-1" style={{ minHeight: 44 }} onClick={() => { reset(); void load(); }}>Cancel</button>
            <button type="submit" className="btn-gradient pressable flex-1" style={{ minHeight: 44 }} disabled={busy || !password}>Continue</button>
          </div>
        </form>
      )}

      {stage.kind === 'scan' && (
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void confirm(); }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Scan this with your authenticator app (1Password, Google Authenticator, Authy…), then enter the code it shows.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <img src={stage.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg shrink-0" style={{ imageRendering: 'pixelated' }} />
            <div className="min-w-0 w-full">
              <p className="label mb-1">Or type this key</p>
              <p className="font-mono text-sm break-all select-all" style={{ color: 'var(--fg)' }} data-testid="totp-secret">{stage.secret}</p>
            </div>
          </div>
          <Field id="twofa-code" label="Code from the app" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" />
          {errorLine}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost pressable flex-1" style={{ minHeight: 44 }} onClick={() => { reset(); setStage({ kind: 'off' }); }}>Cancel</button>
            <button type="submit" className="btn-gradient pressable flex-1" style={{ minHeight: 44 }} disabled={busy || code.trim().length < 6}>Turn on</button>
          </div>
        </form>
      )}

      {stage.kind === 'codes' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Save these recovery codes somewhere safe. Each gets you in once if you lose your phone. This is the only time they are shown.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm rounded-xl p-3" aria-label="Recovery codes" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--fg)' }}>
            {stage.codes.map(c => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost pressable flex-1 text-xs" style={{ minHeight: 44 }} onClick={() => { void copyCodes(stage.codes); }}>Copy</button>
            <button type="button" className="btn-ghost pressable flex-1 text-xs" style={{ minHeight: 44 }} onClick={() => downloadCodes(stage.codes)}>Download</button>
          </div>
          <button type="button" className="btn-gradient pressable w-full" style={{ minHeight: 44 }} onClick={() => { reset(); void load(); }}>I've saved them</button>
        </div>
      )}

      {stage.kind === 'on' && (
        <>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Signing in asks for a code from your authenticator app.{' '}
            <span className="font-mono tabular-nums">{stage.remaining}</span> recovery code{stage.remaining === 1 ? '' : 's'} left.
          </p>
          {stage.remaining <= 3 && (
            <p className="text-xs" style={{ color: 'var(--accent)' }}>Running low — make a new set.</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" className="btn-ghost pressable flex-1 text-xs" style={{ minHeight: 44 }} onClick={() => { reset(); setStage({ kind: 'password', purpose: 'codes' }); }}>
              New recovery codes
            </button>
            <button type="button" className="btn-ghost pressable flex-1 text-xs" style={{ minHeight: 44, color: 'var(--neg)' }} onClick={() => { reset(); setStage({ kind: 'disable' }); }}>
              Turn off
            </button>
          </div>
        </>
      )}

      {stage.kind === 'disable' && (
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void turnOff(); }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Your password and a code from the app (or a recovery code) turn it off.</p>
          <Field id="twofa-disable-password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          <Field id="twofa-disable-code" label="Code" value={code} onChange={setCode} autoComplete="one-time-code" />
          {errorLine}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost pressable flex-1" style={{ minHeight: 44 }} onClick={() => { reset(); void load(); }}>Cancel</button>
            <button type="submit" className="pressable flex-1 rounded-xl text-sm font-semibold" style={{ minHeight: 44, backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }} disabled={busy || !password || code.trim().length < 6}>
              Turn off two-factor
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

export default TwoFactorSection;
