import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Trim } from '../../common/decorators/trim.decorator';
import type { EstadoReporte } from '../../database/entities';

const ORDEN_VALUES = ['recientes', 'populares'] as const;
export type OrdenReporte = (typeof ORDEN_VALUES)[number];
const ESTADO_VALUES: EstadoReporte[] = ['pendiente', 'validado', 'rechazado'];

/** GET /reports: `orden` y `estado` son listas blancas, nunca un campo libre de ordenamiento (4.7). */
export class ReportQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  plataforma?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  categoria?: number;

  @IsOptional()
  @IsIn(ESTADO_VALUES)
  estado?: EstadoReporte;

  @IsOptional()
  @IsIn(ORDEN_VALUES)
  orden?: OrdenReporte;
}
