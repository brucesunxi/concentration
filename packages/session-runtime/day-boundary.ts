/** First instant outside the current family calendar day, including DST changes. */
export function nextFamilyDay(now: number, timezone: string) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const current = format.format(new Date(now));
  let low = Math.floor(now), high = low + 48 * 60 * 60 * 1000;
  if (format.format(new Date(high)) === current) throw new Error('Family calendar boundary is unavailable');
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (format.format(new Date(middle)) === current) low = middle; else high = middle;
  }
  return high;
}
