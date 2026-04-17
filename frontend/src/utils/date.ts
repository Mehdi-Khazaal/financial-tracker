const pad = (n: number) => String(n).padStart(2, '0');

/** Returns today's date as YYYY-MM-DD in the user's LOCAL timezone. */
export const localDateStr = (d = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
