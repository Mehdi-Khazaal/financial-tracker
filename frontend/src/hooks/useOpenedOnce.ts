import { useState } from 'react';

/**
 * True from the first time `open` is true, and from then on.
 *
 * For a sheet that is loaded only when first asked for: it is not rendered
 * (so its code is not fetched) until then, and stays mounted afterwards so
 * closing it still animates and reopening it is instant.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}
