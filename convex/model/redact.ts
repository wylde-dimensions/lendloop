const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Error text that comes back from n8n or an SMTP server can quote the
 * recipient's address. Strip emails and cap the length before storing it.
 */
export function redactError(message: string | undefined, max = 300): string | undefined {
  if (!message) return undefined;
  const clean = message.replace(EMAIL, "[email]").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || undefined;
}
