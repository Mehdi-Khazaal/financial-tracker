import { renderHook } from '@testing-library/react';
import { useOpenedOnce } from './useOpenedOnce';

describe('useOpenedOnce', () => {
  it('stays false until first opened, then stays true', () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), { initialProps: { open: false } });
    expect(result.current).toBe(false);

    rerender({ open: true });
    expect(result.current).toBe(true);

    rerender({ open: false });
    expect(result.current).toBe(true);
  });

  it('is true at once for a sheet that starts open', () => {
    const { result } = renderHook(() => useOpenedOnce(true));
    expect(result.current).toBe(true);
  });
});
