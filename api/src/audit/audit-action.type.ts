/**
 * Catálogo de acciones auditadas (sección 4.6). Lista cerrada a propósito:
 * agregar una acción nueva es una decisión deliberada, no un string suelto
 * en cualquier parte del código.
 */
export type AuditAction =
  | 'login'
  | 'cuenta_bloqueada'
  | 'logout'
  | 'refresh_reuso_detectado'
  | 'registro'
  | 'correo_verificado'
  | 'password_recuperacion_solicitada'
  | 'password_cambiada'
  | '2fa_activado'
  | '2fa_fallo'
  | 'reporte_revisado'
  | 'comentario_moderado'
  | 'usuario_suspendido'
  | 'usuario_reactivado'
  | 'admin_creado'
  | 'catalogo_modificado';
