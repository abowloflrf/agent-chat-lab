import { isIP } from "node:net";

// Classify IP literals as non-public: loopback / private / link-local / ULA /
// CGNAT / cloud-metadata ranges. Used to guard server-side fetches (SSRF).

export function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0 || a === 127) return true; // unspecified / loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export function ipv6IsPrivate(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // strip zone id
  if (addr === "::1" || addr === "::") return true;
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  return false;
}

/** True for any address that is not a routable public IP (or not a valid IP). */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return ipv4IsPrivate(ip);
  if (family === 6) return ipv6IsPrivate(ip);
  return true; // not a parseable IP → unsafe
}
