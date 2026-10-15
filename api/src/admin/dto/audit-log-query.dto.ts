import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AUDIT_ACTIONS, type AuditAction } from '../../audit/audit-action.type';

/** GET /admin/audit-log: filtros por acción, usuario y fechas (sección 7). */
export class AuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  accion?: AuditAction;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  usuario?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hasta?: Date;
}
