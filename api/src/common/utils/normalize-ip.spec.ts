import { normalizeIp } from './normalize-ip';

describe('normalizeIp', () => {
  it('quita el prefijo ::ffff: de una IPv4 mapeada a IPv6', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });

  it('normaliza el loopback IPv6 nativo (::1) a 127.0.0.1', () => {
    expect(normalizeIp('::1')).toBe('127.0.0.1');
  });

  it('deja intacta una IPv4 que ya viene sin mapear', () => {
    expect(normalizeIp('203.0.113.5')).toBe('203.0.113.5');
  });

  it('deja intacta una IPv6 real (no loopback, no mapeada)', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('devuelve null si no hay IP', () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp('')).toBeNull();
  });
});
