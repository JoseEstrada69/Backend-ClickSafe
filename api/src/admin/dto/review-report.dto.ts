import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';
import type { DecisionRevision } from '../../database/entities';

const DECISIONES: DecisionRevision[] = ['validado', 'rechazado'];

export class ReviewReportDto {
  @IsIn(DECISIONES)
  decision!: DecisionRevision;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  @IsNoControlChars({ allowNewline: true })
  comentario?: string;
}
