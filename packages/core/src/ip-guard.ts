// Classificazione IP per la difesa SSRF dell'import da URL.
// Logica PURA (nessuna dipendenza da Node): testabile in isolamento.

function isIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255 && String(n) === p.replace(/^0+(?=\d)/, '');
  });
}

/** Converte un IPv4 in intero senza segno, o null se non valido. */
export function ipv4ToInt(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  const parts = ip.split('.');
  let n = 0;
  for (const p of parts) n = ((n << 8) | Number(p)) >>> 0;
  return n >>> 0;
}

function inV4Range(ip: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const baseInt = ipv4ToInt(base!);
  if (baseInt === null) return false;
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local (include 169.254.169.254 metadata cloud)
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
];

/** true se l'IP (v4 o v6) è privato/interno/loopback/link-local → da bloccare. */
export function isBlockedIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    return BLOCKED_V4.some((c) => inV4Range(n, c));
  }
  // IPv6 (o forma con :) — controllo per prefisso, tollerante.
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    // IPv4-mapped ::ffff:a.b.c.d → valida la parte v4
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)/i.exec(low);
    if (mapped && mapped[1]) return isBlockedIp(mapped[1]);
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(low)) return true; // link-local fe80::/10
    return false;
  }
  return true; // non è un IP riconoscibile → blocca per sicurezza
}
