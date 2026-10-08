const IPV4_MAPPED_IPV6_PATTERN =
  /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/**
 * Normaliza una IPv4 mapeada a IPv6 (`::ffff:127.0.0.1`) a su forma IPv4
 * pura (`127.0.0.1`). Según cómo llegó la conexión, Node puede reportar la
 * MISMA máquina como `::1` o como `::ffff:127.0.0.1` — sin normalizar,
 * Sesion y Bitacora_auditoria agrupan mal los intentos por IP (p. ej. el
 * bloqueo progresivo o un análisis de incidentes verían dos IPs donde hay
 * una sola).
 */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) {
    return null;
  }
  const match = IPV4_MAPPED_IPV6_PATTERN.exec(ip);
  return match ? match[1] : ip;
}
