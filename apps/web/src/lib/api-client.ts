import { apiErrorSchema, type ErrorCode } from '@forge/shared';

export class ApiRequestError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never got an answer. */
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Browser-side call to the Forge API through the web app's same-origin /api proxy, so the session
 * cookie travels with it. Failures always arrive as an ApiRequestError carrying a message that is
 * safe to show to the person.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  fetchImpl: FetchLike = (input, requestInit) => fetch(input, requestInit),
): Promise<T> {
  const { json, headers, ...rest } = init;
  const requestHeaders = new Headers(headers);
  if (json !== undefined) requestHeaders.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetchImpl(path, {
      ...rest,
      headers: requestHeaders,
      credentials: 'same-origin',
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiRequestError(
      0,
      'dependency_unavailable',
      'Could not reach the server. Check your connection.',
    );
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    if (parsed.success) {
      throw new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiRequestError(
      response.status,
      'internal_error',
      `The request failed (${response.status}).`,
    );
  }

  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(
      response.status,
      'internal_error',
      'The server sent an unreadable response.',
    );
  }
}
