const HOSTNAME =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;

function ipv4(host: string): number[] | null {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return null;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.some((part) => part > 255)) return null;
  return parts;
}

function isPrivate(parts: number[]): boolean {
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function assertHostAllowed(raw: string): string {
  const host = raw.trim().toLowerCase();
  if (!host || /[:/@\s\\]/.test(host)) throw new Error("Host is not allowed");
  if (host === "metadata.google.internal") throw new Error("Host is not allowed");

  const ip = ipv4(host);
  if (ip) {
    if (ip[0] === 0 || (ip[0] === 169 && ip[1] === 254)) {
      throw new Error("Host is not allowed");
    }
    if (process.env.HTTP_BLOCK_PRIVATE === "true" && isPrivate(ip)) {
      throw new Error("Host is not allowed");
    }
    return host;
  }

  if (
    process.env.HTTP_BLOCK_PRIVATE === "true" &&
    (host === "localhost" || host.endsWith(".local"))
  ) {
    throw new Error("Host is not allowed");
  }
  if (!HOSTNAME.test(host)) throw new Error("Host is not allowed");
  return host;
}

export function assertPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port is invalid");
  }
  return port;
}
