import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsCatalogName } from '../../common/validators/catalog-name.validator';

/**
 * POST /admin/platforms (sección 1 regla 10, sección 7): `esOtra` nunca se
 * acepta aquí — solo existe la plataforma "Otra" del .sql (CLAUDE.md). El
 * ValidationPipe global (whitelist + forbidNonWhitelisted) rechaza con 400
 * cualquier body que incluya ese campo, porque este DTO no lo declara.
 */
export class CreatePlatformDto {
  @Trim()
  @IsString()
  @Length(2, 100)
  @IsCatalogName()
  nombre!: string;
}
