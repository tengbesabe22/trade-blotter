const databaseErrors = new Set([
  'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError', 'PrismaClientValidationError',
  'PrismaClientRustPanicError',
]);

export function errorMetadata(error: unknown) {
  if (error === undefined) return {};
  if (!(error instanceof Error)) return { errorCategory: 'unexpected_error' };

  // Never serialize an error or its message/stack: either can contain request/SQL data.
  if (databaseErrors.has(error.name)) {
    const code = 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code)
      ? error.code : undefined;
    return { errorCategory: 'database_error', ...(code ? { errorCode: code } : {}) };
  }
  return { errorCategory: error.name === 'ZodError' ? 'validation_error' : 'unexpected_error' };
}
