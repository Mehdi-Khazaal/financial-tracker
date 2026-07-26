/**
 * IndexedDB-backed mutation queue.
 *
 * Every write goes through here. The queue persists across reloads and
 * network outages: the row appears in the UI instantly (optimistic), the
 * request is fired immediately when possible, and if it fails or the tab is
 * offline it stays in IDB until the next `online` event or manual flush.
 *
 * Idempotency-Key is generated once per enqueued mutation and reused on
 * every retry. The backend caches (user, key) → response for 24h, so
 * duplicate submissions are safe.
 *
 * Kept dependency-free — no `idb` wrapper. The API surface is deliberately
 * tiny so pages and modals do not have to think about IndexedDB.
 */

import api from './api';

export type MutationKind =
  | 'transaction.create'
  | 'transaction.update'
  | 'transaction.delete';

export interface QueuedMutation<TPayload = any, TSnapshot = any> {
  /** Client-generated UUID; used as Idempotency-Key and as temp row id. */
  id: string;
  kind: MutationKind;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  payload: TPayload;
  /** Local optimistic snapshot rendered while the server call is pending. */
  snapshot: TSnapshot;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

const DB_NAME = 'ftrack-mutations';
const STORE = 'queue';
const DB_VERSION = 1;

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: QueuedMutation[] = [];
let ready: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => T | Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result: T;
    Promise.resolve(work(store)).then(r => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function loadAll(): Promise<QueuedMutation[]> {
  return tx('readonly', store => new Promise<QueuedMutation[]>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as QueuedMutation[]);
    req.onerror = () => reject(req.error);
  }));
}

function notify() {
  listeners.forEach(fn => {
    try { fn(); } catch { /* listener errors must not break the queue */ }
  });
}

async function refreshCache(): Promise<void> {
  cache = (await loadAll()).sort((a, b) => a.createdAt - b.createdAt);
  notify();
}

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = refreshCache().catch(() => { /* cache stays empty */ });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { void flush(); });
    }
  }
  return ready;
}

export function getPending(): QueuedMutation[] {
  return cache;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  void ensureReady();
  return () => listeners.delete(fn);
}

function newId(): string {
  const g: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (g && typeof g.randomUUID === 'function') return g.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface EnqueueOptions<TPayload, TSnapshot, TResult> {
  kind: MutationKind;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  payload: TPayload;
  snapshot: TSnapshot;
  /** Called once the request finally succeeds. Receives server response. */
  onSuccess?: (result: TResult, snapshot: TSnapshot) => void;
  /** Called if the request fails with a non-network error (4xx/5xx). */
  onError?: (message: string, snapshot: TSnapshot) => void;
}

/**
 * Enqueue a mutation. Returns immediately with the mutation record so the
 * caller can render an optimistic UI. The queue fires the request in the
 * background; on success or terminal failure the corresponding callback runs.
 */
export async function enqueue<TPayload, TSnapshot, TResult = any>(
  opts: EnqueueOptions<TPayload, TSnapshot, TResult>,
): Promise<QueuedMutation<TPayload, TSnapshot>> {
  await ensureReady();

  const mutation: QueuedMutation<TPayload, TSnapshot> = {
    id: newId(),
    kind: opts.kind,
    method: opts.method,
    path: opts.path,
    payload: opts.payload,
    snapshot: opts.snapshot,
    createdAt: Date.now(),
    attempts: 0,
  };

  await tx('readwrite', store => store.put(mutation));
  cache = [...cache, mutation].sort((a, b) => a.createdAt - b.createdAt);
  notify();

  // Fire immediately; if it fails, it stays in the queue for a later flush.
  void submit(mutation, opts as EnqueueOptions<TPayload, TSnapshot, TResult>);

  return mutation;
}

const inflight = new Set<string>();

function isNetworkError(err: unknown): boolean {
  const anyErr = err as { code?: string; response?: unknown };
  if (!anyErr) return true;
  if (anyErr.response) return false;
  return true;
}

async function submit<TPayload, TSnapshot, TResult>(
  mutation: QueuedMutation<TPayload, TSnapshot>,
  opts: EnqueueOptions<TPayload, TSnapshot, TResult>,
): Promise<void> {
  if (inflight.has(mutation.id)) return;
  inflight.add(mutation.id);
  try {
    const response = await api.request<TResult>({
      url: mutation.path,
      method: mutation.method,
      data: mutation.method === 'DELETE' ? undefined : mutation.payload,
      headers: { 'Idempotency-Key': mutation.id },
    });
    await tx('readwrite', store => store.delete(mutation.id));
    cache = cache.filter(m => m.id !== mutation.id);
    notify();
    opts.onSuccess?.(response.data, mutation.snapshot);
  } catch (err: any) {
    mutation.attempts += 1;
    mutation.lastError = err?.message || 'unknown';
    if (isNetworkError(err)) {
      // Network flake — leave it queued; `online` handler will retry.
      await tx('readwrite', store => store.put(mutation));
      notify();
    } else {
      // Terminal server error (4xx/5xx). Drop and surface to the caller.
      await tx('readwrite', store => store.delete(mutation.id));
      cache = cache.filter(m => m.id !== mutation.id);
      notify();
      const message = err?.response?.data?.detail || err?.message || 'Request failed';
      opts.onError?.(String(message), mutation.snapshot);
    }
  } finally {
    inflight.delete(mutation.id);
  }
}

/** Retry every queued mutation. Callbacks were only wired on the original
 * `enqueue` call — after a page reload we no longer have them, so retries
 * just try to complete the request and drop it if the server accepts.
 */
export async function flush(): Promise<void> {
  await ensureReady();
  for (const mutation of [...cache]) {
    if (inflight.has(mutation.id)) continue;
    inflight.add(mutation.id);
    try {
      await api.request({
        url: mutation.path,
        method: mutation.method,
        data: mutation.method === 'DELETE' ? undefined : mutation.payload,
        headers: { 'Idempotency-Key': mutation.id },
      });
      await tx('readwrite', store => store.delete(mutation.id));
      cache = cache.filter(m => m.id !== mutation.id);
      notify();
    } catch (err: any) {
      if (!isNetworkError(err)) {
        // Terminal — drop so we do not spin forever on a broken mutation.
        await tx('readwrite', store => store.delete(mutation.id));
        cache = cache.filter(m => m.id !== mutation.id);
        notify();
      }
    } finally {
      inflight.delete(mutation.id);
    }
  }
}
