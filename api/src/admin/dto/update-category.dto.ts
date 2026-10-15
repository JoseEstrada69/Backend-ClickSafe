import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsCatalogName } from '../../common/validators/catalog-name.validator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';

/** PATCH /admin/categories/:id (sección 7). */
export class UpdateCategoryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 100)
  @IsCatalogName()
  nombre?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  @IsNoControlChars()
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
