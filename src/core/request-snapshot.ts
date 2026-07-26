import { isSensitiveHeaderName, isSensitiveName } from "./sensitive.js";

export interface RequestSnapshot {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function redactHeader(name: string, value: string): string {
  return isSensitiveHeaderName(name) ? "[REDACTED]" : value;
}

export function snapshotRequest(request: Request | RequestSnapshot): RequestSnapshot {
  const headers = Object.create(null) as Record<string, string>;
  if (request instanceof Request) {
    request.headers.forEach((value, name) => {
      headers[name] = redactHeader(name, value);
    });
  } else {
    for (const [name, value] of Object.entries(request.headers)) {
      headers[name.toLowerCase()] = redactHeader(name, value);
    }
  }

  const url = new URL(request.url);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveName(key)) {
      url.searchParams.set(key, "[REDACTED]");
    }
  }

  return Object.freeze({
    method: request.method,
    url: url.toString(),
    headers: Object.freeze(headers),
  });
}
