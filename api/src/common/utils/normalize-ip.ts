const IPV4_MAPPED_IPV6_PATTERN =
  /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
const IPV6_LOOPBACK = '::1';
const IPV4_LOOPBACK = '127.0.0.1';

/**
 * Normaliza representaciones distintas de la MISMA máquina a una sola
 * forma IPv4: la mapeada a IPv6 (`::ffff:127.0.0.1` -> `127.0.0.1`) y el
 * loopback IPv6 nativo (`::1` -> `127.0.0.1`). Según cómo llegó la
 * conexión, Node puede reportar localhost de cualquiera de las tres
 * formas — sin normalizar, Sesion y Bitacora_auditoria agrupan mal los
 * intentos por IP (p. ej. el bloqueo progresivo o un análisis de
 * incidentes verían dos o tres IPs donde hay una sola).
 */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) {
    return null;
  }
  if (ip === IPV6_LOOPBACK) {
    return IPV4_LOOPBACK;
  }
  const match = IPV4_MAPPED_IPV6_PATTERN.exec(ip);
  return match ? match[1] : ip;
}
