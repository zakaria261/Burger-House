/** Next.js can normalize a loopback URL to localhost while preserving the real Host header. */
export function isSameOrigin(request: Request) {
  const raw = request.headers.get('origin');
  if (!raw) return true;
  try {
    const origin = new URL(raw);
    const url = new URL(request.url);
    if (origin.origin === url.origin) return true;
    const host = request.headers.get('host');
    return !!host && origin.host === host && origin.protocol === url.protocol;
  } catch {
    return false;
  }
}
