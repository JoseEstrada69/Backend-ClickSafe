import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { BEARER_AUTH_SCHEME_NAME } from '../common/swagger/bearer-auth.constant';
import {
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { CategoryResponse, PlatformResponse } from './dto/catalog-response.dto';
import { CatalogsService } from './catalogs.service';

@ApiBearerAuth(BEARER_AUTH_SCHEME_NAME)
@ApiUnauthorizedResponse()
@ApiTooManyRequestsResponse()
@Controller()
export class CatalogsController {
  constructor(private readonly catalogsService: CatalogsService) {}

  @Get('platforms')
  @ApiOkResponse({
    description: 'Plataformas activas, para elegir al crear un reporte.',
    type: [PlatformResponse],
  })
  listPlatforms(): Promise<PlatformResponse[]> {
    return this.catalogsService.listPlatforms();
  }

  @Get('categories')
  @ApiOkResponse({
    description: 'Categorías de fraude activas.',
    type: [CategoryResponse],
  })
  listCategories(): Promise<CategoryResponse[]> {
    return this.catalogsService.listCategories();
  }
}
