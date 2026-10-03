import { BitacoraAuditoria } from './bitacora-auditoria.entity';
import { CaptchaUsado } from './captcha-usado.entity';
import { CategoriaFraude } from './categoria-fraude.entity';
import { Comentario } from './comentario.entity';
import { DenunciaComentario } from './denuncia-comentario.entity';
import { Evidencia } from './evidencia.entity';
import { LikeReporte } from './like-reporte.entity';
import { Notificacion } from './notificacion.entity';
import { Plataforma } from './plataforma.entity';
import { Reporte } from './reporte.entity';
import { RevisionReporte } from './revision-reporte.entity';
import { Sesion } from './sesion.entity';
import { TokenVerificacion } from './token-verificacion.entity';
import { Usuario } from './usuario.entity';

export * from './bitacora-auditoria.entity';
export * from './captcha-usado.entity';
export * from './categoria-fraude.entity';
export * from './comentario.entity';
export * from './denuncia-comentario.entity';
export * from './evidencia.entity';
export * from './like-reporte.entity';
export * from './notificacion.entity';
export * from './plataforma.entity';
export * from './reporte.entity';
export * from './revision-reporte.entity';
export * from './sesion.entity';
export * from './token-verificacion.entity';
export * from './usuario.entity';

/** Lista completa de entidades, usada por DatabaseModule para registrar la conexión. */
export const ENTITIES = [
  Usuario,
  Plataforma,
  CategoriaFraude,
  CaptchaUsado,
  Sesion,
  TokenVerificacion,
  BitacoraAuditoria,
  Reporte,
  Evidencia,
  RevisionReporte,
  LikeReporte,
  Comentario,
  DenunciaComentario,
  Notificacion,
];
