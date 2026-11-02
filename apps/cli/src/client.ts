/** A refusal from the server, with the message it gave (safe to show). */
export class ServerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: { message: string }[] } };

/** How long one request may take before the command gives up, rather than hang. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Calls the Forge API. A token, when given, goes only in the Authorization header. */
export async function call<T>(
  server: string,
  path: string,
  options: { method?: string; token?: string; json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.json !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${server}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ServerError(
        0,
        `${server} did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Is Forge running there?`,
      );
    }
    throw new ServerError(0, `Could not reach ${server}. Is Forge running there?`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    const { code, message, details } = body.error ?? {};
    if (response.status === 401) {
      throw new ServerError(401, 'Your sign-in has expired or was revoked. Run `forge login`.');
    }
    // A refused move carries its real reason in the details; a query may have several.
    const reason =
      code === 'validation_failed' && details && details.length > 0
        ? details.map((detail) => detail.message).join('\n')
        : undefined;
    throw new ServerError(
      response.status,
      reason ?? message ?? `The server said ${response.status}.`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
