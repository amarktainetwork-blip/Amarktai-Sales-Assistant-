import { lookup } from "node:dns/promises";
import net from "node:net";

export function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

export function isPrivateAddress(address: string) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith("2001:db8:")) return true;
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      return net.isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
    }
    return false;
  }
  return true;
}

export async function assertPublicHttpUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Browser connectors may navigate only to HTTP(S) business URLs.");
  if (url.username || url.password) throw new Error("Browser connector URLs may not contain embedded credentials.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Browser connector URLs may use only standard HTTP(S) ports.");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("Local or private-network browser destinations are not permitted.");
  if (net.isIP(hostname) && isPrivateAddress(hostname)) throw new Error("Local or private-network browser destinations are not permitted.");
  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("The browser connector hostname could not be resolved.");
  }
  if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new Error("The browser connector hostname resolves to a private or unsafe network address.");
  return url;
}
