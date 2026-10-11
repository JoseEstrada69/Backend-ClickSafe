export interface CommentResponse {
  id: number;
  contenido: string;
  anonimo: boolean;
  autor: { nombre: string } | null;
  esMio: boolean;
  fechaCreacion: string;
}
