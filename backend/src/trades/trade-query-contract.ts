import { z } from 'zod';

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 200;
const MAX_FILTER_VALUES = 20;
const MAX_CURSOR_LENGTH = 2048;

// Hono req.queries() preserves repeated parameters as arrays.
// A tuple rejects duplicate singleton parameters instead of silently taking one.
const singleParameter = z.tuple([z.string()]).transform(([value]) => value);

function sortedUnique<Value extends string>(values: Value[]): Value[] {
  return [...new Set(values)].sort();
}

function textFilter(maxLength: number) {
  return singleParameter.pipe(
    z.string().trim().max(maxLength)
      .transform((value) => value ? value.toLowerCase() : null),
  ).default(null);
}

const pageLimit = singleParameter.pipe(
  z.string().regex(/^[1-9]\d*$/, 'Limit must be a positive integer.')
    .transform(Number)
    .pipe(z.number().int().min(1).max(MAX_PAGE_LIMIT)),
).default(DEFAULT_PAGE_LIMIT);

const symbols = z.array(z.string().trim().toUpperCase().min(1).max(12))
  .max(MAX_FILTER_VALUES)
  .default([])
  .transform((values) => sortedUnique(values));

const traderIds = z.array(z.uuid().transform((value) => value.toLowerCase()))
  .max(MAX_FILTER_VALUES)
  .default([])
  .transform((values) => sortedUnique(values));

// Empty selections mean All; selecting both enum options normalises to that same query.
const statuses = z.array(z.enum(['ACTIVE', 'CANCELLED']))
  .max(MAX_FILTER_VALUES)
  .default([])
  .transform((values) => sortedUnique(values))
  .transform((values) => values.length === 2 ? [] : values);

const sides = z.array(z.enum(['BUY', 'SELL']))
  .max(MAX_FILTER_VALUES)
  .default([])
  .transform((values) => sortedUnique(values))
  .transform((values) => values.length === 2 ? [] : values);

const executionTime = singleParameter.pipe(
  z.iso.datetime({ offset: true })
    .regex(
      /T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
      'Execution time must include seconds, a timezone, and at most three fractional digits.',
    )
    .transform((value) => new Date(value).toISOString())
    .pipe(z.iso.datetime({ precision: 3 })),
).optional().transform((value) => value ?? null);

// Cursor contents are validated separately after query parsing.
const cursor = singleParameter.pipe(z.string().min(1).max(MAX_CURSOR_LENGTH)).optional();

const queryParametersSchema = z.strictObject({
  limit: pageLimit,
  sortBy: singleParameter.pipe(
    z.enum(['tradeDate', 'symbol', 'trader', 'quantity', 'price', 'status']),
  ).default('tradeDate'),
  sortDirection: singleParameter.pipe(z.enum(['asc', 'desc'])).default('desc'),
  symbol: symbols,
  traderId: traderIds,
  status: statuses,
  side: sides,
  book: textFilter(64),
  counterparty: textFilter(120),
  tradeDateFrom: executionTime,
  tradeDateTo: executionTime,
  after: cursor,
}).superRefine((query, context) => {
  // Both values are fixed-format UTC ISO strings, so lexical order matches time.
  if (query.tradeDateFrom && query.tradeDateTo && query.tradeDateFrom >= query.tradeDateTo) {
    context.addIssue({
      code: 'custom',
      path: ['tradeDateTo'],
      message: 'The execution-time upper bound must be after the lower bound.',
    });
  }
});

export const tradeListQuerySchema = queryParametersSchema.transform((query) => {
  return {
    limit: query.limit,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    symbols: query.symbol,
    traderIds: query.traderId,
    statuses: query.status,
    sides: query.side,
    book: query.book,
    counterparty: query.counterparty,
    tradeDateFrom: query.tradeDateFrom,
    tradeDateTo: query.tradeDateTo,
    after: query.after ?? null,
  };
});

export type NormalizedTradeListQuery = z.output<typeof tradeListQuerySchema>;
