import { EstadoReporte } from '../database/entities';

export interface EvidenceRefResponse {
  id: number;
  url: string;
}

export interface ReportRevisionResponse {
  decision: 'validado' | 'rechazado';
  comentario: string | null;
  fecha: string;
}

/** Forma de un reporte en respuestas (sección 7). autor es null si anonimo=true: nunca se exponen datos del autor anónimo. */
export interface ReportResponse {
  id: number;
  titulo: string;
  descripcion: string;
  urlPublicacion: string;
  plataforma: { id: number; nombre: string };
  plataformaOtra: string | null;
  categoria: { id: number; nombre: string };
  estado: EstadoReporte;
  anonimo: boolean;
  autor: { nombre: string } | null;
  esMio: boolean;
  likedByMe: boolean;
  totalLikes: number;
  totalComentarios: number;
  evidencias: EvidenceRefResponse[];
  revision: ReportRevisionResponse | null;
  fechaCreacion: string;
  fechaActualizacion: string;
}
