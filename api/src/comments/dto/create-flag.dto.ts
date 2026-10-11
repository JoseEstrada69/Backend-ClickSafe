import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';
import type { MotivoDenuncia } from '../../database/entities';

const MOTIVOS: MotivoDenuncia[] = [
  'spam',
  'acoso',
  'lenguaje_ofensivo',
  'informacion_personal',
  'otro',
];

export class CreateFlagDto {
  @IsIn(MOTIVOS)
  motivo!: MotivoDenuncia;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  @IsNoControlChars()
  detalle?: string;
}
