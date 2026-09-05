export class UserError extends Error {}

export const errorCause = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';

  return `${error.message}${cause}`;
};

export const errorSentence = (error: unknown): string =>
  `Error: ${errorCause(error)
    .replace(/[\r\n\x1b]+/g, ' ')
    .replace(/[.!]+$/, '')}.`;
