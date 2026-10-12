import { IsIn } from 'class-validator';

const ACCIONES = ['confirmar', 'restaurar'] as const;
export type AccionModeracion = (typeof ACCIONES)[number];

export class ModerateCommentDto {
  @IsIn(ACCIONES)
  accion!: AccionModeracion;
}
