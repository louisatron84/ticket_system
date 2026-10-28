const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/**
 * True only for a Host header naming this machine. Development-only routes use it to refuse
 * requests that reached a local server through a hostile DNS name (DNS rebinding).
 */
export function isLoopbackHost(value: string | undefined): boolean {
  return value !== undefined && LOOPBACK_HOST.test(value.trim());
}

/**
 * True only for a connection that really comes from this machine: the socket's own peer address,
 * which no header can change. (Host and X-Forwarded-For are whatever the sender typed.)
 */
export function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const address = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}
