import { z } from 'zod';

const isRealDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

// Accepts 'YYYY-MM-DD' (and full ISO strings from older clients) and keeps only the calendar day.
export const dateOnlySchema = z
  .string({ error: 'La fecha es obligatoria.' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'La fecha debe tener el formato AAAA-MM-DD.')
  .transform((value) => value.slice(0, 10))
  .refine(isRealDate, 'La fecha no es válida.');
