const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
]);

const SENSITIVE_SEGMENT = /(?:^|[-_])(?:access[-_]?token|api[-_]?key|auth(?:orization)?|client[-_]?secret|credential|password|refresh[-_]?token|secret|session(?:id)?|token)(?=$|[-_])/i;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_SEGMENT.test(name);
}

export function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  return SENSITIVE_HEADERS.has(normalized) || isSensitiveName(normalized);
}
