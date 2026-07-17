import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import { useToast } from '../context/ToastContext';
import {
  AssistantConversation,
  AssistantMessage,
  AssistantPendingAction,
  AssistantVisualBlock,
  assistantChat,
  assistantDeleteConversation,
  assistantExecute,
  assistantGetBriefing,
  assistantGetConversation,
  assistantListConversations,
} from '../utils/api';
import './Assistant.css';

interface ChatMessage extends AssistantMessage {
  id: string;
  blocks?: AssistantVisualBlock[];
}

type RequestError = { message: string; kind: 'error' | 'offline' | 'stopped' } | null;

const SUGGESTIONS = [
  { label: 'This month', prompt: 'How much did I spend this month?' },
  { label: 'Categories', prompt: 'What are my biggest spending categories this month?' },
  { label: 'Record expense', prompt: 'Add a $12 coffee expense to my main account' },
  { label: 'Savings', prompt: 'Am I on track with my savings goals?' },
];

const ACTION_LABELS: Record<string, string> = {
  add_transaction: 'Transaction',
  add_account: 'Account',
  add_savings_goal: 'Savings goal',
  add_loan: 'Loan',
};

const FOLLOW_UPS: Record<AssistantVisualBlock['type'], string> = {
  metric_grid: 'Break down my balances',
  category_breakdown: 'Show the transactions behind this',
  transaction_list: 'Summarize this activity',
  progress_list: 'Which savings goal needs attention?',
  account_list: 'Compare these accounts',
  cashflow_trend: 'Explain the biggest monthly change',
};

const iconPaths = {
  history: 'M4 5h12M4 10h12M4 15h12',
  plus: 'M10 3v14M3 10h14',
  trash: 'M4 6h12M8 6V4h4v2m-6 0 1 11h6l1-11M8 9v5m4-5v5',
  send: 'M3 3l14 7-14 7 2-7-2-7zm2 7h7',
  stop: 'M6 6h8v8H6z',
  close: 'M5 5l10 10M15 5L5 15',
  retry: 'M15.5 7A6 6 0 106 15.2M15.5 7V3m0 4h-4',
  spark: 'M10 2.5l1 3.1a4 4 0 002.6 2.6l3.1 1-3.1 1a4 4 0 00-2.6 2.6l-1 3.2-1-3.2a4 4 0 00-2.6-2.6l-3.1-1 3.1-1A4 4 0 009 5.6l1-3.1z',
};

const Icon: React.FC<{ name: keyof typeof iconPaths; size?: number }> = ({ name, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={iconPaths[name]} />
  </svg>
);

const currency = (value: number, currencyCode = 'USD') => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `$${value.toLocaleString()}`;
  }
};

const AssistantReply: React.FC<{ content: string }> = ({ content }) => (
  <ReactMarkdown
    allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre', 'a', 'br', 'hr']}
    components={{
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
      ),
    }}
  >
    {content}
  </ReactMarkdown>
);

const VisualBlock: React.FC<{ block: AssistantVisualBlock; onFollowUp: (prompt: string) => void }> = ({ block, onFollowUp }) => {
  const rows = block.rows ?? [];
  const trendMax = Math.max(1, ...rows.flatMap(row => [row.income ?? 0, row.spending ?? 0]));
  return (
    <section className="assistant-data-block" aria-label={block.title}>
      <div className="assistant-data-heading">
        <div>
          <h3>{block.title}</h3>
          <p>{block.scope}</p>
        </div>
        {typeof block.total === 'number' && <strong className="value-display">{currency(block.total)}</strong>}
      </div>

      {block.type === 'metric_grid' && (
        <dl className="assistant-metric-grid">
          {(block.metrics ?? []).map(metric => (
            <div key={metric.label}>
              <dt>{metric.label}</dt>
              <dd className="value-display">{metric.format === 'currency' ? currency(metric.value) : metric.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}

      {block.type === 'category_breakdown' && (
        <div className="assistant-breakdown">
          {rows.length ? rows.map((row, index) => (
            <div className="assistant-breakdown-row" key={`${row.label}-${index}`}>
              <div className="assistant-row-copy"><span>{row.label}</span><strong>{currency(row.value)}</strong></div>
              <div className="assistant-bar" aria-label={`${Math.round((row.share ?? 0) * 100)} percent`}>
                <span style={{ width: `${Math.max(2, (row.share ?? 0) * 100)}%`, background: `var(--cat-${(index % 8) + 1})` }} />
              </div>
            </div>
          )) : <p className="assistant-data-empty">No spending matched this period.</p>}
        </div>
      )}

      {['transaction_list', 'account_list'].includes(block.type) && (
        <div className="assistant-ledger-list">
          {rows.length ? rows.map((row, index) => (
            <div className="assistant-ledger-row" key={row.id ?? `${row.label}-${index}`}>
              <div><strong>{row.label}</strong><span>{row.detail ?? row.date ?? ''}</span></div>
              <span className={`font-mono ${block.type === 'transaction_list' && row.value < 0 ? 'is-negative' : ''}`}>
                {currency(row.value, row.currency)}
              </span>
            </div>
          )) : <p className="assistant-data-empty">No records matched this request.</p>}
        </div>
      )}

      {block.type === 'progress_list' && (
        <div className="assistant-progress-list">
          {rows.length ? rows.map((row, index) => {
            const progress = row.target ? Math.min(100, Math.max(0, row.value / row.target * 100)) : 0;
            return (
              <div key={row.id ?? `${row.label}-${index}`} className="assistant-progress-row">
                <div className="assistant-row-copy"><span>{row.label}</span><strong>{currency(row.value)} / {currency(row.target ?? 0)}</strong></div>
                <div className="assistant-bar"><span style={{ width: `${progress}%` }} /></div>
                {row.date && <small>Target date {row.date}</small>}
              </div>
            );
          }) : <p className="assistant-data-empty">No savings goals are set up yet.</p>}
        </div>
      )}

      {block.type === 'cashflow_trend' && (
        <div className="assistant-trend" role="img" aria-label="Monthly income and spending comparison">
          <div className="assistant-trend-plot">
            {rows.map((row, index) => (
              <div className="assistant-trend-month" key={`${row.label}-${index}`}>
                <div className="assistant-trend-bars">
                  <span className="is-income" style={{ height: `${Math.max(2, (row.income ?? 0) / trendMax * 100)}%` }} title={`Income ${currency(row.income ?? 0)}`} />
                  <span className="is-spending" style={{ height: `${Math.max(2, (row.spending ?? 0) / trendMax * 100)}%` }} title={`Spending ${currency(row.spending ?? 0)}`} />
                </div>
                <span>{row.label?.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="assistant-trend-legend"><span><i className="is-income" />Income</span><span><i className="is-spending" />Spending</span></div>
        </div>
      )}

      <footer className="assistant-data-footer">
        <span>{block.source}</span>
        <button type="button" onClick={() => onFollowUp(FOLLOW_UPS[block.type])}>{FOLLOW_UPS[block.type]}</button>
      </footer>
    </section>
  );
};

const Assistant: React.FC = () => {
  const toast = useToast();
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [briefing, setBriefing] = useState<AssistantVisualBlock[]>([]);
  const [pending, setPending] = useState<AssistantPendingAction[]>([]);
  const [executingToken, setExecutingToken] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [requestError, setRequestError] = useState<RequestError>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef('');

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await assistantListConversations();
      setConversations(data);
    } catch {
      // Chat remains usable when history is temporarily unavailable.
    }
  }, []);

  const loadBriefing = useCallback(async () => {
    try {
      const { data } = await assistantGetBriefing();
      setBriefing(data.blocks);
    } catch {
      setBriefing([]);
    }
  }, []);

  useEffect(() => { loadConversations(); loadBriefing(); }, [loadBriefing, loadConversations]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, loading, requestError]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [input]);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    requestAnimationFrame(() => historyButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeHistory();
      if (event.key !== 'Tab' || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeHistory, historyOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const openConversation = async (id: number) => {
    closeHistory();
    if (id === activeId) return;
    try {
      const { data } = await assistantGetConversation(id);
      setActiveId(id);
      setMessages(data.messages.map((message, index) => ({ ...message, id: `${id}-${index}` })));
      setPending([]);
      setRequestError(null);
    } catch {
      toast.error('Could not open that chat');
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setPending([]);
    setRequestError(null);
    setHistoryOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeConversation = async (id: number) => {
    try {
      await assistantDeleteConversation(id);
      if (id === activeId) newChat();
      await loadConversations();
    } catch {
      toast.error('Could not delete chat');
    }
  };

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    if (!navigator.onLine) {
      lastPromptRef.current = content;
      setRequestError({ kind: 'offline', message: 'You are offline. Reconnect to ask Fin.' });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    lastPromptRef.current = content;
    setInput('');
    setPending([]);
    setRequestError(null);
    setMessages(previous => [...previous, { id: `user-${Date.now()}`, role: 'user', content }]);
    setLoading(true);
    try {
      const { data } = await assistantChat(content, activeId, controller.signal);
      setActiveId(data.conversation_id);
      setMessages(previous => [...previous, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        blocks: data.visual_blocks ?? [],
      }]);
      setPending(data.pending_actions ?? []);
      loadConversations();
      loadBriefing();
    } catch (error: any) {
      if (controller.signal.aborted) {
        setRequestError({ kind: 'stopped', message: 'Response stopped. You can retry the request.' });
      } else {
        const detail = error?.response?.data?.detail || 'Fin could not respond. Please try again.';
        setRequestError({ kind: navigator.onLine ? 'error' : 'offline', message: detail });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [activeId, input, loadBriefing, loadConversations, loading]);

  const stop = () => abortRef.current?.abort();

  const retryLastPrompt = () => {
    const prompt = lastPromptRef.current;
    setMessages(previous => {
      const last = previous[previous.length - 1];
      return last?.role === 'user' && last.content === prompt ? previous.slice(0, -1) : previous;
    });
    setRequestError(null);
    window.setTimeout(() => send(prompt), 0);
  };

  const confirmAction = async (action: AssistantPendingAction) => {
    setExecutingToken(action.action_token);
    try {
      const { data } = await assistantExecute(action, activeId);
      setPending(previous => previous.filter(item => item.action_token !== action.action_token));
      setMessages(previous => [...previous, { id: `confirmed-${Date.now()}`, role: 'assistant', content: data.message }]);
      toast.success(data.message);
      loadBriefing();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Could not complete that action');
    } finally {
      setExecutingToken(null);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const isEmpty = messages.length === 0;
  const statusText = useMemo(() => loading ? 'Fin is reviewing your ledger' : online ? 'Connected to your ledger' : 'Offline', [loading, online]);

  return (
    <AppShell>
      <PageLayout scrollRegion="contained" className="assistant-page">
        <div className="assistant-workspace">
          {historyOpen && <button type="button" className="assistant-drawer-backdrop" aria-label="Close chat history" onClick={closeHistory} />}
          <aside
            ref={drawerRef}
            className={`assistant-rail ${historyOpen ? 'is-open' : ''}`}
            aria-label="Chat history"
            aria-modal={historyOpen ? true : undefined}
            role={historyOpen ? 'dialog' : undefined}
          >
            <div className="assistant-rail-header">
              <button type="button" className="assistant-new-chat pressable" onClick={newChat}><Icon name="plus" size={18} /> New chat</button>
              <button type="button" className="assistant-icon-button assistant-close-drawer" onClick={closeHistory} aria-label="Close history"><Icon name="close" /></button>
            </div>
            <div className="assistant-history app-scrollbar">
              {conversations.map(conversation => (
                <div className={`assistant-history-row ${conversation.id === activeId ? 'is-active' : ''}`} key={conversation.id}>
                  <button type="button" onClick={() => openConversation(conversation.id)} aria-current={conversation.id === activeId ? 'true' : undefined}>
                    <span>{conversation.title || 'Untitled chat'}</span>
                    <time>{new Date(conversation.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                  </button>
                  <button type="button" className="assistant-delete-chat" onClick={() => removeConversation(conversation.id)} aria-label={`Delete ${conversation.title || 'chat'}`} title="Delete chat"><Icon name="trash" size={17} /></button>
                </div>
              ))}
              {!conversations.length && <p className="assistant-history-empty">Your conversations will appear here.</p>}
            </div>
          </aside>

          <section className="assistant-chat" aria-label="Fin financial assistant">
            <header className="assistant-header">
              <button ref={historyButtonRef} type="button" className="assistant-icon-button assistant-history-trigger" onClick={() => setHistoryOpen(true)} aria-label="Open chat history" aria-expanded={historyOpen}><Icon name="history" /></button>
              <div className="assistant-mark"><Icon name="spark" size={17} /></div>
              <div className="assistant-title">
                <h1>Fin</h1>
                <p><span className={`assistant-status-dot ${online ? '' : 'is-offline'}`} />{statusText}</p>
              </div>
            </header>

            <div ref={scrollRef} className="assistant-scroll app-scrollbar" role="log" aria-live="polite" aria-relevant="additions" aria-busy={loading}>
              <div className="assistant-thread">
                {isEmpty && (
                  <section className="assistant-briefing" aria-labelledby="assistant-briefing-title">
                    <div className="assistant-briefing-intro">
                      <div><span>Daily briefing</span><h2 id="assistant-briefing-title">Your finances, ready to discuss.</h2></div>
                      <p>Ask for an explanation, a comparison, or prepare a change for your approval.</p>
                    </div>
                    {briefing.map((block, index) => <VisualBlock block={block} onFollowUp={send} key={`briefing-${block.type}-${index}`} />)}
                    {!briefing.length && <div className="assistant-no-data"><strong>No ledger data yet</strong><span>Connect or add an account, then Fin can build a grounded briefing.</span></div>}
                    <div className="assistant-suggestions" aria-label="Suggested questions">
                      {SUGGESTIONS.map(suggestion => <button type="button" key={suggestion.label} onClick={() => send(suggestion.prompt)}><span>{suggestion.label}</span>{suggestion.prompt}</button>)}
                    </div>
                  </section>
                )}

                {messages.map(message => (
                  <article className={`assistant-message is-${message.role}`} key={message.id} aria-label={`${message.role === 'user' ? 'You' : 'Fin'} said`}>
                    {message.role === 'assistant' && <span className="assistant-message-name">Fin</span>}
                    <div className="assistant-bubble">
                      {message.role === 'assistant' ? <AssistantReply content={message.content} /> : message.content}
                    </div>
                    {message.blocks?.map((block, index) => <VisualBlock block={block} onFollowUp={send} key={`${message.id}-${block.type}-${index}`} />)}
                  </article>
                ))}

                {pending.map(action => (
                  <section className="assistant-confirmation" key={action.action_token} aria-label={`Confirm ${ACTION_LABELS[action.tool] || 'change'}`}>
                    <div className="assistant-confirmation-heading"><span>Approval required</span><strong>{ACTION_LABELS[action.tool] || action.tool}</strong></div>
                    <p>{action.summary}</p>
                    <div>
                      <button type="button" className="assistant-confirm" disabled={executingToken === action.action_token} onClick={() => confirmAction(action)}>{executingToken === action.action_token ? 'Saving...' : 'Confirm change'}</button>
                      <button type="button" className="assistant-dismiss" disabled={executingToken === action.action_token} onClick={() => setPending(previous => previous.filter(item => item.action_token !== action.action_token))}>Dismiss</button>
                    </div>
                  </section>
                ))}

                {loading && <div className="assistant-thinking" role="status"><span /><span /><span /><p>Reviewing your ledger...</p></div>}
                {requestError && (
                  <div className={`assistant-error is-${requestError.kind}`} role="alert">
                    <div><strong>{requestError.kind === 'offline' ? 'Connection unavailable' : requestError.kind === 'stopped' ? 'Response stopped' : 'Could not complete request'}</strong><span>{requestError.message}</span></div>
                    <button type="button" onClick={retryLastPrompt} disabled={!online}><Icon name="retry" size={17} /> Retry</button>
                  </div>
                )}
              </div>
            </div>

            <footer className="assistant-composer-shell">
              {!online && <div className="assistant-offline-banner" role="status">Offline. Your message stays here until you reconnect.</div>}
              <div className="assistant-composer">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  maxLength={4000}
                  placeholder="Ask about your money"
                  aria-label="Message Fin"
                  disabled={loading}
                />
                {loading ? (
                  <button type="button" className="assistant-send is-stop" onClick={stop} aria-label="Stop response" title="Stop response"><Icon name="stop" /></button>
                ) : (
                  <button type="button" className="assistant-send" onClick={() => send()} disabled={!input.trim() || !online} aria-label="Send message" title="Send message"><Icon name="send" /></button>
                )}
              </div>
              <p>Fin reads your ledger. Changes require your confirmation.</p>
            </footer>
          </section>
        </div>
      </PageLayout>
    </AppShell>
  );
};

export default Assistant;
