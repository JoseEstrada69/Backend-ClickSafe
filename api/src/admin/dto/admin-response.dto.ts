import type {
  EstadoComentario,
  EstadoReporte,
  MotivoDenuncia,
} from '../../database/entities';
import { ReportRevisionResponse } from '../../reports/dto/report-response.dto';

export class AdminUserRefResponse {
  nombre!: string;
  correo!: string;
}

export class AdminReportPlatformRefResponse {
  id!: number;
  nombre!: string;
}

export class AdminReportCategoryRefResponse {
  id!: number;
  nombre!: string;
}

export class AdminEvidenceRefResponse {
  id!: number;
  url!: string;
}

/** Igual a ReportResponse pero con el autor real siempre visible, aunque el reporte sea anónimo (sección 7): solo para la cola de admin. */
export class AdminReportResponse {
  id!: number;
  titulo!: string;
  descripcion!: string;
  urlPublicacion!: string;
  plataforma!: AdminReportPlatformRefResponse;
  plataformaOtra!: string | null;
  categoria!: AdminReportCategoryRefResponse;
  estado!: EstadoReporte;
  anonimo!: boolean;
  autor!: AdminUserRefResponse;
  totalLikes!: number;
  evidencias!: AdminEvidenceRefResponse[];
  fechaCreacion!: string;
  fechaActualizacion!: string;
}

/** GET /admin/reports/:id (sección 7): detalle con revisión (si ya la tiene), esMio (si el admin es el autor) y totalComentarios (solo visibles, igual que el detalle público). */
export class AdminReportDetailResponse extends AdminReportResponse {
  revision!: ReportRevisionResponse | null;
  esMio!: boolean;
  totalComentarios!: number;
}

export class FlaggedCommentResponse {
  id!: number;
  contenido!: string;
  estado!: EstadoComentario;
  totalDenuncias!: number;
  autor!: AdminUserRefResponse;
  reporteId!: number;
  motivos!: MotivoDenuncia[];
  fechaCreacion!: string;
}

export class AdminUserResponse {
  id!: number;
  nombre!: string;
  correo!: string;
  rol!: 'usuario' | 'admin';
  activo!: boolean;
  correoVerificado!: boolean;
  fechaRegistro!: string;
}

export class AdminStatsPlatformEntry {
  plataforma!: string;
  total!: number;
}

export class AdminStatsCategoryEntry {
  categoria!: string;
  total!: number;
}

export class AdminStatsStateEntry {
  estado!: EstadoReporte;
  total!: number;
}

/** `mes` en formato "YYYY-MM", UTC (sección 1 regla 11). */
export class AdminStatsMonthEntry {
  mes!: string;
  total!: number;
}

export class AdminStatsResponse {
  porPlataforma!: AdminStatsPlatformEntry[];
  porCategoria!: AdminStatsCategoryEntry[];
  porEstado!: AdminStatsStateEntry[];
  /** Últimos 12 meses en UTC, de más antiguo a más reciente; incluye meses sin reportes con total 0. */
  porMes!: AdminStatsMonthEntry[];
}

export class AdminPlatformResponse {
  id!: number;
  nombre!: string;
  esOtra!: boolean;
  activa!: boolean;
}

export class AdminCategoryResponse {
  id!: number;
  nombre!: string;
  descripcion!: string | null;
  activa!: boolean;
}

export class AuditLogEntryResponse {
  id!: string;
  fecha!: string;
  idUsuario!: number | null;
  /** null cuando el evento no tiene usuario asociado (p. ej. login con correo inexistente). */
  usuario!: AdminUserRefResponse | null;
  accion!: string;
  resultado!: 'exito' | 'fallo';
  recursoTipo!: string | null;
  recursoId!: number | null;
  ip!: string | null;
  userAgent!: string | null;
  detalle!: Record<string, unknown> | null;
}
