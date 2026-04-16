import { useEffect, useRef, useState } from 'react';

const THRESHOLD = 65;

export const usePullToRefresh = (onRefresh: () => Promise<void> | void) => {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const isDragging = useRef(false);

  useEffect(() => {
    const el = document.documentElement;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      isDragging.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setPulling(false); setPullDistance(0); return; }
      if (el.scrollTop > 0) { isDragging.current = false; return; }
      const dist = Math.min(dy * 0.5, THRESHOLD * 1.4);
      setPulling(true);
      setPullDistance(dist);
    };

    const onTouchEnd = async () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (pullDistance >= THRESHOLD) {
        setRefreshing(true);
        setPullDistance(0);
        setPulling(false);
        try { await onRefresh(); } finally { setRefreshing(false); }
      } else {
        setPulling(false);
        setPullDistance(0);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove',  onTouchMove,  { passive: true });
    window.addEventListener('touchend',   onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove',  onTouchMove);
      window.removeEventListener('touchend',   onTouchEnd);
    };
  }, [onRefresh, pullDistance, refreshing]);

  return { pulling, refreshing, pullDistance };
};
