const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/**
 * True only for a Host header naming this machine. Development-only routes use it to refuse
 * requests that reached a local server through a hostile DNS name (DNS rebinding).
 */
export function isLoopbackHost(value: string | undefined): boolean {
  return value !== undefined && LOOPBACK_HOST.test(value.trim());
}
