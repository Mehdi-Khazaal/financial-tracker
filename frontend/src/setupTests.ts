import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Testing Library's `waitFor` advances fake timers only when it finds a
// Jest-shaped global (it calls `jest.advanceTimersByTime`). Vitest's fake
// timers are otherwise invisible to it and every `waitFor` under
// `vi.useFakeTimers()` would simply time out. This shim routes the call to
// Vitest; it is the documented approach and touches nothing else.
Object.defineProperty(globalThis, 'jest', {
  value: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
  configurable: true,
  writable: true,
});
