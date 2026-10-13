import type { EstadoComentario } from '../../database/entities';

export class CommentAuthorRefResponse {
  nombre!: string;
}

export class CommentResponse {
  id!: number;
  contenido!: string;
  anonimo!: boolean;
  autor!: CommentAuthorRefResponse | null;
  esMio!: boolean;
  fechaCreacion!: string;
}

/** GET /me/comments (sección 7): un comentario propio con el contexto del reporte al que pertenece. */
export class MyCommentResponse extends CommentResponse {
  reporteId!: number;
  reporteTitulo!: string;
  estado!: EstadoComentario;
}
