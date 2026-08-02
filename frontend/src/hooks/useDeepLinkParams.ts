import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Reads deep-link query parameters once on arrival, then strips them.
 *
 * Applying once matters: without it, re-running the effect would keep forcing
 * the arriving filter back on every render and the user could never change it.
 * Stripping matters for the opposite reason — a URL still saying
 * `?account=3` after the user has cleared that filter is a lie about what is on
 * screen. The replace is silent, so the browser's back button still returns to
 * wherever the link was clicked rather than to a parameterless copy of the
 * current page.
 *
 * The trade-off is that reloading the page loses the arriving context. That is
 * the right side to err on: a filter the user can see and change beats a URL
 * that quietly reapplies itself.
 */
export function useDeepLinkParams(
  apply: (params: URLSearchParams) => void,
  /** Wait until the page has the data it needs to honour the parameters. */
  ready = true,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const consumed = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (consumed.current || !ready) return;
    // Nothing to consume — leave the URL untouched rather than pushing a
    // redundant history entry on every plain visit.
    if (Array.from(searchParams.keys()).length === 0) return;

    consumed.current = true;
    applyRef.current(searchParams);
    setSearchParams({}, { replace: true });
  }, [ready, searchParams, setSearchParams]);
}
