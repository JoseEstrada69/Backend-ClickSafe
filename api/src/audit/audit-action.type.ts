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
  | 'catalogo_modificado'
  // Agregada en Fase 6: DELETE /admin/reports/:id/evidences/:evidenceId
  // (sección 6, punto 8) no tenía una acción dedicada en la lista original.
  | 'evidencia_eliminada'
  // PATCH /me/password con passwordActual incorrecta: antes no se auditaba
  // ni contaba para el bloqueo progresivo (5.1/5.4), solo lanzaba 401.
  | 'password_cambio_fallo';

/**
 * Mismos valores que AuditAction, pero en tiempo de ejecución: un alias de
 * tipo no existe para `instanceof`/`@IsIn`. Se usa para validar el filtro
 * `accion` de GET /admin/audit-log y para documentarlo (junto con el campo
 * `accion` de la respuesta) como enum en el OpenAPI, en vez de un string libre.
 */
export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'login',
  'cuenta_bloqueada',
  'logout',
  'refresh_reuso_detectado',
  'registro',
  'correo_verificado',
  'password_recuperacion_solicitada',
  'password_cambiada',
  '2fa_activado',
  '2fa_fallo',
  'reporte_revisado',
  'comentario_moderado',
  'usuario_suspendido',
  'usuario_reactivado',
  'admin_creado',
  'catalogo_modificado',
  'evidencia_eliminada',
  'password_cambio_fallo',
];
