// Calendar-day helpers. Expiration dates are plain 'YYYY-MM-DD' values interpreted in America/Bogota.
export const appTimeZone = 'America/Bogota';

export const todayInBogota = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const toUtcMidnight = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
};

export const addDays = (day: string, amount: number): string => new Date(toUtcMidnight(day) + amount * 86_400_000).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number => Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / 86_400_000);
