import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Documenta la forma común de todo listado paginado (sección 7):
 * { items: T[], page, limit, total }. @nestjs/swagger no soporta genéricos
 * reales, así que el schema se compone a mano con $ref al modelo de item.
 */
export function ApiPaginatedResponse<TModel extends Type<unknown>>(
  model: TModel,
  description?: string,
) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description,
      schema: {
        properties: {
          items: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
    }),
  );
}
