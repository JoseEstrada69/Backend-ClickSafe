import type {
  EstadoComentario,
  EstadoReporte,
  MotivoDenuncia,
} from '../database/entities';

/** Igual a ReportResponse pero con el autor real siempre visible, aunque el reporte sea anónimo (sección 7): solo para la cola de admin. */
export interface AdminReportResponse {
  id: number;
  titulo: string;
  descripcion: string;
  urlPublicacion: string;
  plataforma: { id: number; nombre: string };
  plataformaOtra: string | null;
  categoria: { id: number; nombre: string };
  estado: EstadoReporte;
  anonimo: boolean;
  autor: { nombre: string; correo: string };
  totalLikes: number;
  evidencias: { id: number; url: string }[];
  fechaCreacion: string;
  fechaActualizacion: string;
}

export interface FlaggedCommentResponse {
  id: number;
  contenido: string;
  estado: EstadoComentario;
  totalDenuncias: number;
  autor: { nombre: string; correo: string };
  reporteId: number;
  motivos: MotivoDenuncia[];
  fechaCreacion: string;
}

export interface AdminUserResponse {
  id: number;
  nombre: string;
  correo: string;
  rol: 'usuario' | 'admin';
  activo: boolean;
  correoVerificado: boolean;
  fechaRegistro: string;
}

export interface AdminStatsResponse {
  porPlataforma: { plataforma: string; total: number }[];
  porCategoria: { categoria: string; total: number }[];
  porEstado: { estado: EstadoReporte; total: number }[];
}

export interface AuditLogEntryResponse {
  id: string;
  fecha: string;
  idUsuario: number | null;
  accion: string;
  resultado: 'exito' | 'fallo';
  recursoTipo: string | null;
  recursoId: number | null;
  ip: string | null;
  userAgent: string | null;
  detalle: Record<string, unknown> | null;
}
