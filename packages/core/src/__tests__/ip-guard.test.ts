import { describe, it, expect } from 'vitest';
import { isBlockedIp, ipv4ToInt } from '../ip-guard.js';

describe('isBlockedIp — deve BLOCCARE gli indirizzi interni', () => {
  const blocked = [
    '127.0.0.1', // loopback
    '10.0.0.5', // privato
    '10.255.255.255',
    '172.16.0.1', // privato
    '172.31.255.255',
    '192.168.1.1', // privato
    '169.254.169.254', // metadata cloud AWS/GCP
    '0.0.0.0',
    '100.64.0.1', // CGNAT
    '198.18.0.1', // benchmark
    '224.0.0.1', // multicast
    '::1', // loopback v6
    'fc00::1', // ULA
    'fd12:3456::1', // ULA
    'fe80::1', // link-local v6
    '::ffff:127.0.0.1', // v4-mapped loopback
    '::ffff:169.254.169.254',
    'non-un-ip',
  ];
  for (const ip of blocked) {
    it(`blocca ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }
});

describe('isBlockedIp — deve PERMETTERE gli indirizzi pubblici', () => {
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111'];
  for (const ip of allowed) {
    it(`permette ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }
});

describe('ipv4ToInt', () => {
  it('converte correttamente e rifiuta i malformati', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(0xffffffff);
    expect(ipv4ToInt('192.168.0.1')).toBe(((192 << 24) | (168 << 16) | (0 << 8) | 1) >>> 0);
    expect(ipv4ToInt('256.0.0.1')).toBeNull();
    expect(ipv4ToInt('1.2.3')).toBeNull();
    expect(ipv4ToInt('a.b.c.d')).toBeNull();
  });
});
