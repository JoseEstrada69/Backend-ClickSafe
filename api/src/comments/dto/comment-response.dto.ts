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
