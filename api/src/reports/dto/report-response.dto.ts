import { EstadoReporte } from '../../database/entities';

export class EvidenceRefResponse {
  id!: number;
  url!: string;
}

export class ReportPlatformRefResponse {
  id!: number;
  nombre!: string;
}

export class ReportCategoryRefResponse {
  id!: number;
  nombre!: string;
}

export class ReportAuthorRefResponse {
  nombre!: string;
}

export class ReportRevisionResponse {
  decision!: 'validado' | 'rechazado';
  comentario!: string | null;
  fecha!: string;
}

export class LikeResponse {
  totalLikes!: number;
  likedByMe!: boolean;
}

/** Forma de un reporte en respuestas (sección 7). autor es null si anonimo=true: nunca se exponen datos del autor anónimo. */
export class ReportResponse {
  id!: number;
  titulo!: string;
  descripcion!: string;
  urlPublicacion!: string;
  plataforma!: ReportPlatformRefResponse;
  plataformaOtra!: string | null;
  categoria!: ReportCategoryRefResponse;
  estado!: EstadoReporte;
  anonimo!: boolean;
  autor!: ReportAuthorRefResponse | null;
  esMio!: boolean;
  likedByMe!: boolean;
  totalLikes!: number;
  totalComentarios!: number;
  evidencias!: EvidenceRefResponse[];
  revision!: ReportRevisionResponse | null;
  fechaCreacion!: string;
  fechaActualizacion!: string;
}
