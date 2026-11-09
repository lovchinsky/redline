/**
 * Where a setup sandbox may connect: only to hosts on its project's list, on the TLS port, and
 * never to an address inside the deployment, whatever a name resolves to.
 */

/** `host` is on `allowed`: named exactly, or under a `*.` entry (`*.npmjs.org`). */
export const egressAllows = (allowed: readonly string[], host: string): boolean => {
  const name = host.toLowerCase().replace(/\.$/, '');
  return allowed.some((entry) => {
    const rule = entry.toLowerCase();
    return rule.startsWith('*.') ? name.endsWith(rule.slice(1)) : name === rule;
  });
};

/**
 * Whether `entry` can be on a project's list: a host name, or `*.` and a domain of at least two
 * labels. `*.com` would let a setup reach any host anyone can register.
 */
export const isEgressRule = (entry: string): boolean => {
  const name = entry.startsWith('*.') ? entry.slice(2) : entry;
  const labels = name.split('.');
  const hostname = labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  return hostname && labels.length >= 2;
};

export const EGRESS_PORT = 443;

const ipv4 = (address: string): number[] | null => {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

const privateIpv4 = ([a = 0, b = 0, c = 0]: number[]): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 192 && b === 0 && (c === 0 || c === 2)) ||
  (a === 198 && (b === 18 || b === 19)) ||
  (a === 198 && b === 51 && c === 100) ||
  (a === 203 && b === 0 && c === 113) ||
  a >= 224;

/**
 * Whether `address` (as DNS resolved it) is on the public internet. Loopback, private,
 * link-local, carrier-grade NAT, multicast and reserved ranges are not, in IPv4 and IPv6.
 */
export const isPublicAddress = (address: string): boolean => {
  const v4 = ipv4(address);
  if (v4 !== null) return !privateIpv4(v4);
  const v6 = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1] !== undefined) return isPublicAddress(mapped[1]);
  if (!v6.includes(':')) return false;
  if (v6 === '::' || v6 === '::1') return false;
  const [head = '0', next = '0'] = v6.split(':');
  const first = Number.parseInt(head || '0', 16);
  const second = Number.parseInt(next || '0', 16);
  // Teredo (2001::/32), documentation (2001:db8::/32) and 6to4 (2002::/16) are not reached as
  // themselves: the first and last carry an IPv4 address that may be anyone's.
  if (first === 0x2001 && (second === 0 || second === 0xdb8)) return false;
  if (first === 0x2002) return false;
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast; global unicast is 2000::/3.
  return first >= 0x2000 && first <= 0x3fff;
};
