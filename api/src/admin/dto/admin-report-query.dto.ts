import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { EstadoReporte } from '../../database/entities';

const ESTADO_VALUES: EstadoReporte[] = ['pendiente', 'validado', 'rechazado'];

/** GET /admin/reports: cola de revisión, por defecto solo pendientes (sección 7). */
export class AdminReportQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ESTADO_VALUES)
  estado?: EstadoReporte = 'pendiente';
}
