import React, { useEffect, useState } from 'react';
import { Category } from '../types';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../utils/api';
import Navigation from '../components/Navigation';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const PRESET_COLORS = [
  '#f43f5e', '#ff8e53', '#f59e0b', '#10b981', '#1abc9c',
  '#6366f1', '#a855f7', '#ec4899', '#666e90', '#eef0f8',
];

const Settings: React.FC = () => {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [catTab, setCatTab] = useState<'expense' | 'income'>('expense');

  // Add form
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [adding, setAdding] = useState(false);

  // Inline edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try { const res = await getCategories(); setCategories(res.data); }
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

  const shown = categories.filter(c => c.type === catTab);
  const incomeCount  = categories.filter(c => c.type === 'income').length;
  const expenseCount = categories.filter(c => c.type === 'expense').length;

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-6 fade-in">

          {/* Header */}
          <h1 className="text-xl font-bold text-text">Settings</h1>

          {/* ── Profile ── */}
          <section className="card p-5">
            <p className="label mb-4">Profile</p>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl shrink-0"
                style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
                <span className="text-white">{user?.username.charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <p className="font-semibold text-text">{user?.username}</p>
                <p className="text-sm text-muted">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="mt-4 w-full py-2.5 text-sm font-semibold rounded-xl transition-all"
              style={{ backgroundColor: 'rgba(244,63,94,.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,.15)' }}>
              Sign out
            </button>
          </section>

          {/* ── Categories ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Categories</p>
              <p className="text-xs text-muted">{incomeCount} income · {expenseCount} expense</p>
            </div>

            {/* Tabs */}
            <div className="flex p-1 rounded-xl mb-4" style={{ backgroundColor: '#0d1018' }}>
              {(['expense', 'income'] as const).map(t => (
                <button key={t} onClick={() => setCatTab(t)}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all capitalize"
                  style={catTab === t
                    ? { backgroundColor: t === 'expense' ? 'rgba(244,63,94,.15)' : 'rgba(16,185,129,.15)',
                        color: t === 'expense' ? '#f43f5e' : '#10b981' }
                    : { color: '#666e90' }}>
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
                  style={{ backgroundColor: catTab === 'expense' ? 'rgba(244,63,94,.15)' : 'rgba(16,185,129,.15)',
                           color: catTab === 'expense' ? '#f43f5e' : '#10b981',
                           border: `1px solid ${catTab === 'expense' ? 'rgba(244,63,94,.25)' : 'rgba(16,185,129,.25)'}` }}>
                  {adding ? '…' : '+ Add'}
                </button>
              </div>
            </form>

            {/* List */}
            {loading ? (
              <div className="card py-8 text-center">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent mx-auto spin-slow"
                  style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }} />
              </div>
            ) : shown.length === 0 ? (
              <div className="card py-8 text-center text-muted text-sm">No {catTab} categories yet</div>
            ) : (
              <div className="card overflow-hidden">
                {shown.map((cat, i) => (
                  <div key={cat.id}
                    className={`px-4 py-3 group ${i < shown.length - 1 ? 'border-b border-border' : ''}`}>

                    {editId === cat.id ? (
                      /* ── Edit mode ── */
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
                            style={{ backgroundColor: 'rgba(16,185,129,.15)', color: '#10b981' }}>
                            {saving ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditId(null)}
                            className="px-3 py-2 text-xs font-semibold rounded-lg"
                            style={{ backgroundColor: '#1a1f2e', color: '#666e90' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── View mode ── */
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <p className="text-sm text-text flex-1">{cat.name}</p>
                        {cat.is_system && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: '#1a1f2e', color: '#666e90' }}>default</span>
                        )}
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(cat)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
                            style={{ backgroundColor: 'rgba(99,102,241,.1)', color: '#6366f1' }}>
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                          </button>
                          <button onClick={() => handleDelete(cat.id, cat.name)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
                            style={{ backgroundColor: 'rgba(244,63,94,.1)', color: '#f43f5e' }}>
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

        </div>
      </main>
    </>
  );
};

export default Settings;
