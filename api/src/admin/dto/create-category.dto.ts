import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsCatalogName } from '../../common/validators/catalog-name.validator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';

/** POST /admin/categories (sección 7). */
export class CreateCategoryDto {
  @Trim()
  @IsString()
  @Length(2, 100)
  @IsCatalogName()
  nombre!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  @IsNoControlChars()
  descripcion?: string;
}
