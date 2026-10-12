import { Transform, Type } from 'class-transformer';
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

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

/** multipart/form-data (sección 7): los campos de texto llegan como string, de ahí los @Type/@Transform. */
export class CreateReportDto {
  @Trim()
  @IsString()
  @Length(1, 150)
  @IsNoControlChars()
  titulo!: string;

  @Trim()
  @IsString()
  @Length(20, 5000)
  @IsNoControlChars({ allowNewline: true })
  descripcion!: string;

  @IsString()
  @MaxLength(2048)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: true,
    disallow_auth: true,
  })
  urlPublicacion!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  plataformaId!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  @IsNoControlChars()
  plataformaOtra?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  categoriaId!: number;

  @Transform(toBoolean)
  @IsBoolean()
  anonimo!: boolean;
}
