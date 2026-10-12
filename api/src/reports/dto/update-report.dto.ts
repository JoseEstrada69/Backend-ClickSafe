import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';

/**
 * PATCH /reports/:id (JSON): solo campos de texto, catálogo y anonimato
 * (sección 7, alcance reducido — las evidencias solo se suben al crear).
 * Todos opcionales: se actualiza únicamente lo que venga en el body.
 */
export class UpdateReportDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 150)
  @IsNoControlChars()
  titulo?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(20, 5000)
  @IsNoControlChars({ allowNewline: true })
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: true,
    disallow_auth: true,
  })
  urlPublicacion?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  plataformaId?: number;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  @IsNoControlChars()
  plataformaOtra?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  categoriaId?: number;

  @IsOptional()
  @IsBoolean()
  anonimo?: boolean;
}
