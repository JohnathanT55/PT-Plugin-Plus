const SENSITIVE_ASSIGNMENT_PATTERN =
  /(["']?\b(?:cookie|authorization|passkey|token|password|secret|api[-_]?key)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^,\r\n}\]]+)/gi;
const URL_PATTERN = /\b(?:https?:\/\/|magnet:\?)[^\s"'<>]+/gi;
const MAX_ERROR_MESSAGE_LENGTH = 2000;

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error, (key, value) =>
      /^(?:cookie|authorization|passkey|token|password|secret|api[-_]?key)$/i.test(key) ? "[redacted]" : value,
    );
  } catch {
    return String(error);
  }
}

/**
 * Keep a useful failure reason in download history without persisting torrent
 * URLs, cookies, authorization headers, passkeys, or downloader credentials.
 */
export function sanitizeDownloadErrorMessage(error: unknown): string {
  const message = stringifyError(error)
    .replace(URL_PATTERN, "[redacted URL]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1[redacted]")
    .trim();

  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`;
}
