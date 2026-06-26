import React, { useEffect, useRef, useState, useCallback } from 'react';
import Navigation from '../components/Navigation';
import { useToast } from '../context/ToastContext';
import {
  assistantListConversations,
  assistantGetConversation,
  assistantDeleteConversation,
  assistantChat,
  assistantExecute,
} from '../utils/api';

type Role = 'user' | 'assistant';
interface Msg { role: Role; content: string; }
interface Conversation { id: number; title: string; updated_at: string; }
interface PendingAction { tool: string; input: any; summary: string; }

const SUGGESTIONS = [
  'How much did I spend this month?',
  'What are my biggest spending categories?',
  'Add a $12 coffee expense to my main account',
  'Am I on track with my savings goals?',
];

const ACTION_LABELS: Record<string, string> = {
  add_transaction: 'New transaction',
  add_account: 'New account',
  add_savings_goal: 'New savings goal',
  add_loan: 'New loan',
};

const Assistant: React.FC = () => {
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await assistantListConversations();
      setConversations(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, loading]);

  const openConversation = async (id: number) => {
    setHistoryOpen(false);
    if (id === activeId) return;
    try {
      const res = await assistantGetConversation(id);
      setActiveId(id);
      setMessages(res.data.messages.map((m: any) => ({ role: m.role, content: m.content })));
      setPending([]);
    } catch {
      toast.error('Could not open that chat');
    }
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setPending([]);
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  const removeConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await assistantDeleteConversation(id);
      if (id === activeId) newChat();
      loadConversations();
    } catch {
      toast.error('Could not delete chat');
    }
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput('');
    setPending([]);
    setMessages(prev => [...prev, { role: 'user', content }]);
    setLoading(true);
    try {
      const res = await assistantChat(content, activeId);
      setActiveId(res.data.conversation_id);
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
      setPending(res.data.pending_actions || []);
      loadConversations();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Something went wrong. Please try again.';
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${detail}` }]);
    } finally {
      setLoading(false);
    }
  };

  const confirmAction = async (action: PendingAction, idx: number) => {
    try {
      const res = await assistantExecute(action.tool, action.input, activeId);
      setPending(prev => prev.filter((_, i) => i !== idx));
      setMessages(prev => [...prev, { role: 'assistant', content: `✅ ${res.data.message}` }]);
      toast.success(res.data.message);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not complete that action');
    }
  };

  const dismissAction = (idx: number) => setPending(prev => prev.filter((_, i) => i !== idx));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const isEmpty = messages.length === 0;

  return (
    <>
      <Navigation />

      <div className="md:ml-60 min-h-[100dvh] flex" style={{ backgroundColor: 'var(--bg)' }}>

        {/* ── Conversation rail ───────────────────────────────────────── */}
        <aside
          className={`assistant-rail fixed md:static inset-y-0 left-0 z-30 w-64 shrink-0 flex flex-col transition-transform md:translate-x-0 ${historyOpen ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ backgroundColor: 'var(--bg)', borderRight: '1px solid var(--line)' }}>
          <div className="topbar-safe shrink-0 p-3">
            <button
              onClick={newChat}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold pressable"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" /></svg>
              New chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {conversations.map(c => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`group w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left ${c.id === activeId ? 'nav-item-active' : 'nav-item'}`}>
                <span className="flex-1 truncate" style={{ color: 'var(--fg)' }}>{c.title || 'Untitled'}</span>
                <span
                  onClick={(e) => removeConversation(c.id, e)}
                  className="opacity-0 group-hover:opacity-100 shrink-0"
                  style={{ color: 'var(--dim)' }}
                  title="Delete chat">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                </span>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="px-3 py-4 text-xs" style={{ color: 'var(--dim)' }}>No conversations yet.</p>
            )}
          </div>
        </aside>

        {/* Mobile overlay backdrop */}
        {historyOpen && (
          <div className="fixed inset-0 z-20 md:hidden" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setHistoryOpen(false)} />
        )}

        {/* ── Chat column ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ minHeight: '100dvh' }}>

          {/* Header */}
          <div className="topbar-safe shrink-0 flex items-center gap-3 pr-24 md:pr-5 pl-4 md:pl-5 py-2.5 border-b" style={{ borderColor: 'var(--line)' }}>
            <button className="md:hidden" onClick={() => setHistoryOpen(true)} style={{ color: 'var(--muted)' }} title="Chat history">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
            </button>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #F97316 0%, #C2410C 100%)' }}>
              <svg viewBox="0 0 20 20" fill="#fff" className="w-4 h-4"><path d="M10 2.5l.9 3.1a4.4 4.4 0 002.9 2.9l3.2.9-3.2.9a4.4 4.4 0 00-2.9 2.9l-.9 3.3-.9-3.3a4.4 4.4 0 00-2.9-2.9L3 9.4l3.2-.9a4.4 4.4 0 002.9-2.9L10 2.5z" /></svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight truncate" style={{ color: 'var(--fg)' }}>Fin · Financial Assistant</h1>
              <p className="text-[11px] leading-tight" style={{ color: 'var(--dim)' }}>Knows your data · remembers your chats</p>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
            <div className="max-w-3xl mx-auto space-y-4">
              {isEmpty && !loading && (
                <div className="pt-8 pb-4 text-center">
                  <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--fg)', fontFamily: 'var(--font-serif)' }}>How can I help with your money?</h2>
                  <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>Ask about your spending, balances, or have me record something.</p>
                  <div className="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto">
                    {SUGGESTIONS.map(s => (
                      <button key={s} onClick={() => send(s)}
                        className="text-left text-sm px-4 py-3 rounded-xl pressable"
                        style={{ background: 'var(--elev-1)', border: '1px solid var(--line)', color: 'var(--fg)' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words"
                    style={m.role === 'user'
                      ? { background: 'var(--accent)', color: '#fff', borderBottomRightRadius: 4 }
                      : { background: 'var(--elev-1)', border: '1px solid var(--line)', color: 'var(--fg)', borderBottomLeftRadius: 4 }}>
                    {m.content}
                  </div>
                </div>
              ))}

              {/* Pending confirmation cards */}
              {pending.map((a, i) => (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] w-full rounded-2xl overflow-hidden" style={{ background: 'var(--elev-1)', border: '1px solid var(--accent)' }}>
                    <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'rgba(249,115,22,0.08)', color: 'var(--accent)' }}>
                      Confirm · {ACTION_LABELS[a.tool] || a.tool}
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-sm mb-3" style={{ color: 'var(--fg)' }}>{a.summary}</p>
                      <div className="flex gap-2">
                        <button onClick={() => confirmAction(a, i)}
                          className="flex-1 h-9 rounded-lg text-sm font-semibold pressable"
                          style={{ background: 'var(--accent)', color: '#fff' }}>Confirm</button>
                        <button onClick={() => dismissAction(i)}
                          className="flex-1 h-9 rounded-lg text-sm font-medium pressable"
                          style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)' }}>Dismiss</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="px-4 py-3 rounded-2xl" style={{ background: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full typing-dot" style={{ background: 'var(--dim)' }} />
                      <span className="w-1.5 h-1.5 rounded-full typing-dot" style={{ background: 'var(--dim)', animationDelay: '0.15s' }} />
                      <span className="w-1.5 h-1.5 rounded-full typing-dot" style={{ background: 'var(--dim)', animationDelay: '0.3s' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 px-4 md:px-6 pb-4 pt-2 mobile-tabs-spacer" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="max-w-3xl mx-auto flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Ask Fin anything about your money…"
                className="flex-1 resize-none rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: 'var(--elev-1)', border: '1px solid var(--line)', color: 'var(--fg)', maxHeight: 140 }}
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
                className="h-11 w-11 shrink-0 rounded-xl flex items-center justify-center pressable disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
                title="Send">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M3.4 2.6a1 1 0 00-1.3 1.2l2 6.2 9.1 0-9.1 0-2 6.2a1 1 0 001.3 1.2l14-7a1 1 0 000-1.8l-14-7z" /></svg>
              </button>
            </div>
            <p className="max-w-3xl mx-auto text-[10px] mt-1.5 text-center" style={{ color: 'var(--dim)' }}>
              Fin can read your data and prepare changes — nothing is saved until you confirm.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Assistant;
