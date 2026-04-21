import React, { useEffect, useState, useCallback } from 'react';
import { Category } from '../types';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../utils/api';
import Navigation from '../components/Navigation';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { subscribeToPush, unsubscribeFromPush, isPushSupported, getPushPermission } from '../utils/push';
import { changePassword, adminGetUsers, adminResetPassword, plaidCreateLinkToken, plaidExchangeToken, plaidGetItems, plaidDeleteItem, plaidSyncAll, plaidReset } from '../utils/api';
import { usePlaidLink } from 'react-plaid-link';

const PRESET_COLORS = [
  '#f43f5e', '#ff8e53', '#f59e0b', '#10b981', '#1abc9c',
  '#6366f1', '#a855f7', '#ec4899', '#8a8a94', '#ededee',
];

const Settings: React.FC = () => {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [catTab, setCatTab] = useState<'expense' | 'income'>('expense');

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [adding, setAdding] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try { const res = await getCategories(); setCategories(Array.isArray(res.data) ? res.data : []); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await createCategory({ name: newName.trim(), type: catTab, color: newColor });
      setNewName(''); setNewColor(PRESET_COLORS[0]);
      load(); toast.success('Category created');
    } catch { toast.error('Failed to create category'); }
    finally { setAdding(false); }
  };

  const startEdit = (cat: Category) => {
    setEditId(cat.id); setEditName(cat.name); setEditColor(cat.color);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updateCategory(id, { name: editName.trim(), color: editColor });
      setEditId(null); load(); toast.success('Category updated');
    } catch { toast.error('Failed to update category'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete "${name}"? Transactions using it will lose their category.`, { danger: true });
    if (!ok) return;
    try { await deleteCategory(id); load(); toast.success('Category deleted'); }
    catch { toast.error('Failed to delete'); }
  };

  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      toast.success('Password changed successfully');
      setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Failed to change password');
    } finally { setPwLoading(false); }
  };

  const [plaidItems, setPlaidItems] = useState<any[]>([]);
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [plaidResetting, setPlaidResetting] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null);

  const loadPlaidItems = useCallback(async () => {
    try { const r = await plaidGetItems(); setPlaidItems(Array.isArray(r.data) ? r.data : []); } catch {}
  }, []);

  useEffect(() => { loadPlaidItems(); }, [loadPlaidItems]);

  useEffect(() => {
    plaidCreateLinkToken().then(r => setPlaidLinkToken(r.data.link_token)).catch(() => {});
  }, []);

  const { open: openPlaidLink, ready: plaidReady } = usePlaidLink({
    token: plaidLinkToken,
    receivedRedirectUri: undefined,
    onSuccess: async (public_token, metadata) => {
      const institution_name = (metadata as any)?.institution?.name as string | undefined;
      try {
        await plaidExchangeToken(public_token, institution_name);
        toast.success(`${institution_name || 'Bank'} connected! Syncing transactions...`);
        await loadPlaidItems();
        plaidCreateLinkToken().then(r => setPlaidLinkToken(r.data.link_token)).catch(() => setPlaidLinkToken(null));
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Failed to connect bank');
        plaidCreateLinkToken().then(r => setPlaidLinkToken(r.data.link_token)).catch(() => setPlaidLinkToken(null));
      }
    },
    onEvent: (eventName, metadata) => {
      const sessionId = (metadata as any)?.link_session_id;
      if (sessionId && (eventName === 'ERROR' || eventName === 'EXIT')) {
        navigator.clipboard.writeText(sessionId).catch(() => {});
        toast(`Session ID copied: ${sessionId}`, { duration: 8000 });
      }
    },
    onExit: () => {},
  });

  const handlePlaidSync = async () => {
    setPlaidSyncing(true);
    try { await plaidSyncAll(); toast.success('Sync started — you\'ll get a notification when done'); }
    catch (e: any) { toast.error(e?.response?.data?.detail || 'Sync failed'); }
    finally { setPlaidSyncing(false); }
  };

  const handlePlaidReset = async () => {
    const ok = window.confirm('This will delete ALL Plaid-imported transactions and disconnect all banks. Your manually-added transactions are safe. Continue?');
    if (!ok) return;
    setPlaidResetting(true);
    try {
      const r = await plaidReset();
      toast.success(r.data.message || 'Plaid data cleared');
      setPlaidItems([]);
      plaidCreateLinkToken().then(r2 => setPlaidLinkToken(r2.data.link_token)).catch(() => {});
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Reset failed'); }
    finally { setPlaidResetting(false); }
  };

  const handleDisconnect = async (item: any) => {
    const ok = await toast.confirm(`Disconnect ${item.institution_name || 'this bank'}? Your existing transactions won't be deleted.`);
    if (!ok) return;
    setDisconnectingId(item.id);
    try { await plaidDeleteItem(item.id); setPlaidItems(p => p.filter(i => i.id !== item.id)); toast.success('Bank disconnected'); }
    catch { toast.error('Failed to disconnect'); }
    finally { setDisconnectingId(null); }
  };

  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [resettingId, setResettingId] = useState<number | null>(null);

  useEffect(() => {
    if (user?.is_admin) {
      setAdminLoading(true);
      adminGetUsers().then(r => setAdminUsers(Array.isArray(r.data) ? r.data : [])).finally(() => setAdminLoading(false));
    }
  }, [user?.is_admin]);

  const handleAdminReset = async (u: any) => {
    const ok = await toast.confirm(`Send a password reset email to ${u.email}?`);
    if (!ok) return;
    setResettingId(u.id);
    try {
      await adminResetPassword(u.id);
      toast.success(`Reset email sent to ${u.email}`);
    } catch { toast.error('Failed to send reset email'); }
    finally { setResettingId(null); }
  };

  const [pushEnabled, setPushEnabled] = useState(getPushPermission() === 'granted');
  const [pushLoading, setPushLoading] = useState(false);

  const togglePush = async () => {
    setPushLoading(true);
    if (pushEnabled) {
      await unsubscribeFromPush();
      setPushEnabled(false);
      toast.success('Notifications disabled');
    } else {
      const ok = await subscribeToPush();
      setPushEnabled(ok);
      if (ok) toast.success('Notifications enabled');
      else toast.error('Could not enable notifications — check browser permissions');
    }
    setPushLoading(false);
  };

  const shown        = categories.filter(c => c.type === catTab);
  const incomeCount  = categories.filter(c => c.type === 'income').length;
  const expenseCount = categories.filter(c => c.type === 'expense').length;

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-6 fade-in">

          <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Settings</h1>

          {/* ── Profile ── */}
          <section className="card p-5">
            <p className="label mb-4">Profile</p>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-md flex items-center justify-center font-mono font-bold text-xl shrink-0"
                style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--accent)' }}>
                {user?.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-text">{user?.username}</p>
                <p className="text-sm text-muted">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="mt-4 w-full py-2.5 text-sm font-semibold rounded-xl transition-all"
              style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.08)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.15)' }}>
              Sign out
            </button>
          </section>

          {/* ── Change Password ── */}
          <section className="card p-5">
            <button onClick={() => setPwOpen(o => !o)}
              className="w-full flex items-center justify-between">
              <p className="label">Security</p>
              <svg className={`w-4 h-4 transition-transform ${pwOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                style={{ color: 'var(--dim)' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {pwOpen && (
              <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
                <div>
                  <p className="label mb-2">Current password</p>
                  <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                    className="input-dark" placeholder="••••••••" required />
                </div>
                <div>
                  <p className="label mb-2">New password</p>
                  <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                    className="input-dark" placeholder="At least 8 characters" required minLength={8} />
                </div>
                <div>
                  <p className="label mb-2">Confirm new password</p>
                  <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    className="input-dark" placeholder="••••••••" required />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={pwLoading}
                    className="btn-gradient flex-1 py-2.5 text-sm disabled:opacity-60">
                    {pwLoading ? 'Saving…' : 'Change Password'}
                  </button>
                  <button type="button" onClick={() => { setPwOpen(false); setCurrentPw(''); setNewPw(''); setConfirmPw(''); }}
                    className="btn-ghost px-4 py-2.5 text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* ── Notifications ── */}
          {isPushSupported() && (
            <section className="card p-5">
              <p className="label mb-4">Notifications</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text">Push notifications</p>
                  <p className="text-xs text-muted mt-0.5">Recurring transactions, savings milestones</p>
                </div>
                <button
                  onClick={togglePush}
                  disabled={pushLoading}
                  className="relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50"
                  style={{ backgroundColor: pushEnabled ? 'var(--accent)' : 'var(--line)' }}>
                  <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                    style={{ transform: pushEnabled ? 'translateX(20px)' : 'translateX(0)' }} />
                </button>
              </div>
            </section>
          )}

          {/* ── Categories ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Categories</p>
              <p className="text-xs text-muted">{incomeCount} income · {expenseCount} expense</p>
            </div>

            {/* Tabs */}
            <div className="flex p-1 rounded-xl mb-4" style={{ backgroundColor: 'var(--elev-1)' }}>
              {(['expense', 'income'] as const).map(t => (
                <button key={t} onClick={() => setCatTab(t)}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all capitalize"
                  style={catTab === t
                    ? { backgroundColor: t === 'expense' ? 'oklch(70% 0.17 25 / 0.15)' : 'oklch(78% 0.16 150 / 0.15)',
                        color: t === 'expense' ? 'var(--neg)' : 'var(--pos)' }
                    : { color: 'var(--muted)' }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Add new */}
            <form onSubmit={handleAdd} className="card p-4 mb-3">
              <p className="label mb-3">Add {catTab} category</p>
              <div className="flex gap-2 flex-wrap mb-3">
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setNewColor(c)}
                    className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: newColor === c ? `3px solid ${c}` : 'none',
                      outlineOffset: '2px',
                    }} />
                ))}
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: newColor }} />
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className="input-dark flex-1"
                    placeholder="Category name"
                  />
                </div>
                <button type="submit" disabled={adding || !newName.trim()}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-40"
                  style={catTab === 'expense'
                    ? { backgroundColor: 'oklch(70% 0.17 25 / 0.12)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.25)' }
                    : { backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.25)' }}>
                  {adding ? '…' : '+ Add'}
                </button>
              </div>
            </form>

            {/* List */}
            {loading ? (
              <div className="card py-8 text-center">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent mx-auto spin-slow"
                  style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              </div>
            ) : shown.length === 0 ? (
              <div className="card py-8 text-center text-muted text-sm">No {catTab} categories yet</div>
            ) : (
              <div className="card overflow-hidden">
                {shown.map((cat, i) => (
                  <div key={cat.id}
                    className="px-4 py-3 group"
                    style={{ borderBottom: i < shown.length - 1 ? '1px solid var(--line)' : 'none' }}>

                    {editId === cat.id ? (
                      <div className="space-y-3">
                        <div className="flex gap-1.5 flex-wrap">
                          {PRESET_COLORS.map(c => (
                            <button key={c} type="button" onClick={() => setEditColor(c)}
                              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                              style={{
                                backgroundColor: c,
                                outline: editColor === c ? `2px solid ${c}` : 'none',
                                outlineOffset: '2px',
                              }} />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <div className="flex items-center gap-2 flex-1">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editColor }} />
                            <input
                              type="text"
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="input-dark flex-1 text-sm"
                              autoFocus
                            />
                          </div>
                          <button onClick={() => handleSaveEdit(cat.id)} disabled={saving || !editName.trim()}
                            className="px-3 py-2 text-xs font-semibold rounded-lg disabled:opacity-40"
                            style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)' }}>
                            {saving ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditId(null)}
                            className="px-3 py-2 text-xs font-semibold rounded-lg"
                            style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <p className="text-sm text-text flex-1">{cat.name}</p>
                        {cat.is_system && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--dim)' }}>default</span>
                        )}
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(cat)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
                            style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)' }}>
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                          </button>
                          <button onClick={() => handleDelete(cat.id, cat.name)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
                            style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Connected Banks ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="label">Connected Banks</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)' }}>
                  PLAID
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {plaidItems.length > 0 && (
                  <button onClick={handlePlaidSync} disabled={plaidSyncing}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
                    style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.1)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.2)' }}>
                    {plaidSyncing ? 'Syncing…' : 'Sync Now'}
                  </button>
                )}
                <button onClick={handlePlaidReset} disabled={plaidResetting}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
                  style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.08)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
                  {plaidResetting ? 'Clearing…' : 'Reset & Start Fresh'}
                </button>
                <button onClick={() => { if (plaidLinkToken) sessionStorage.setItem('plaid_link_token', plaidLinkToken); openPlaidLink(); }} disabled={!plaidReady || !plaidLinkToken}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
                  style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.2)' }}>
                  + Connect Bank
                </button>
              </div>
            </div>

            {plaidItems.length === 0 ? (
              <div className="card py-8 text-center">
                <p className="text-sm text-muted">No banks connected yet.</p>
                <p className="text-xs text-muted mt-1">Connect your bank account to auto-import transactions.</p>
              </div>
            ) : (
              <div className="card overflow-hidden">
                {plaidItems.map((item, i) => (
                  <div key={item.id}
                    className="px-4 py-3 flex items-center gap-3"
                    style={{ borderBottom: i < plaidItems.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <div className="w-8 h-8 rounded-md flex items-center justify-center font-mono font-bold text-sm shrink-0"
                      style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--pos)', border: '1px solid var(--line)' }}>
                      {(item.institution_name || 'B').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text truncate">{item.institution_name || 'Bank'}</p>
                      <p className="text-xs text-muted">Connected {new Date(item.created_at).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => handleDisconnect(item)} disabled={disconnectingId === item.id}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
                      style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
                      {disconnectingId === item.id ? '…' : 'Disconnect'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Admin Panel ── */}
          {user?.is_admin && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <p className="label">Admin — All Users</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }}>
                  ADMIN
                </span>
              </div>

              {adminLoading ? (
                <div className="card py-8 text-center">
                  <div className="w-5 h-5 rounded-full border-2 border-t-transparent mx-auto spin-slow"
                    style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                </div>
              ) : (
                <div className="card overflow-hidden">
                  {adminUsers.map((u, i) => (
                    <div key={u.id}
                      className="px-4 py-3 flex items-center gap-3"
                      style={{ borderBottom: i < adminUsers.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <div className="w-8 h-8 rounded-md flex items-center justify-center font-mono font-bold text-sm shrink-0"
                        style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--accent)', border: '1px solid var(--line)' }}>
                        {u.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text truncate">{u.username}</p>
                          {u.is_admin && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }}>admin</span>
                          )}
                          {u.is_verified && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)' }}>verified</span>
                          )}
                        </div>
                        <p className="text-xs text-muted truncate">{u.email}</p>
                      </div>
                      <button
                        onClick={() => handleAdminReset(u)}
                        disabled={resettingId === u.id}
                        className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
                        style={{ backgroundColor: 'rgba(245,158,11,.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.2)' }}>
                        {resettingId === u.id ? '…' : 'Reset PW'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </main>
    </>
  );
};

export default Settings;
