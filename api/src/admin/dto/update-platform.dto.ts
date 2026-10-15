import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsCatalogName } from '../../common/validators/catalog-name.validator';

/**
 * PATCH /admin/platforms/:id: `esOtra` no se declara aquí a propósito (no
 * se puede modificar vía API, CLAUDE.md). El servicio además rechaza
 * `activa: false` sobre la plataforma "Otra" (nunca se puede desactivar).
 */
export class UpdatePlatformDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 100)
  @IsCatalogName()
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
