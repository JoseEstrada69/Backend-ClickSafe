/** IP y User-Agent del cliente, usados para auditoría (4.6) y Sesion. */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}
