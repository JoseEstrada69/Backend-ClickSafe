import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';

/** POST /admin/categories (sección 7). */
export class CreateCategoryDto {
  @Trim()
  @IsString()
  @Length(1, 100)
  @IsNoControlChars()
  nombre!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  @IsNoControlChars()
  descripcion?: string;
}
