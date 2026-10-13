import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';

/** PATCH /admin/categories/:id (sección 7). */
export class UpdateCategoryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  @IsNoControlChars()
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
