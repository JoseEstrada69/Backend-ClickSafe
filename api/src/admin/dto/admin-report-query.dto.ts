import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const ESTADO_FILTRO_VALUES = [
  'pendiente',
  'validado',
  'rechazado',
  'todos',
] as const;

export type AdminReportEstadoFiltro = (typeof ESTADO_FILTRO_VALUES)[number];

/** GET /admin/reports: cola de revisión, por defecto solo pendientes; `todos` quita el filtro (sección 7). */
export class AdminReportQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ESTADO_FILTRO_VALUES)
  estado?: AdminReportEstadoFiltro = 'pendiente';
}
