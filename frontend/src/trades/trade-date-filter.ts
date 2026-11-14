import { z } from 'zod';

const dateOrBlank = z.union([z.iso.date(), z.literal('')]);

// Explicit UTC midnight avoids the browser's local timezone and daylight-saving changes.
// Example: utcDayBoundary('2026-11-14', 1) -> '2026-11-15T00:00:00.000Z'.
export function utcDayBoundary(date: string, dayOffset = 0): string {
  const boundary = new Date(date + 'T00:00:00.000Z');
  boundary.setUTCDate(boundary.getUTCDate() + dayOffset);
  return boundary.toISOString();
}

export const tradeDateFilterSchema = z.object({
  from: dateOrBlank,
  through: dateOrBlank,
}).refine(({ from, through }) => !from || !through || through >= from, {
  path: ['through'], message: 'Through must be on or after From.',
}).transform(({ from, through }): { tradeDateFrom?: string; tradeDateTo?: string } => ({
  tradeDateFrom: from ? utcDayBoundary(from) : undefined,
  // The UI includes Through; the API excludes the next day's midnight.
  tradeDateTo: through ? utcDayBoundary(through, 1) : undefined,
})).pipe(z.object({
  tradeDateFrom: z.iso.datetime({ precision: 3 }).optional(),
  tradeDateTo: z.iso.datetime({ precision: 3 }).optional(),
}));
