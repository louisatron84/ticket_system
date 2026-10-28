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
    });
  } catch {
    throw new ServerError(0, `Could not reach ${server}. Is Forge running there?`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    const { code, message, details } = body.error ?? {};
    if (response.status === 401) {
      throw new ServerError(401, 'Your sign-in has expired or was revoked. Run `forge login`.');
    }
    // A refused move carries its real reason in the first detail.
    const reason = code === 'validation_failed' ? details?.[0]?.message : undefined;
    throw new ServerError(
      response.status,
      reason ?? message ?? `The server said ${response.status}.`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
