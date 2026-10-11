import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/** Ids de ruta: entero > 0 (4.7). Un id como "-1" o "0" nunca coincide con una fila real, pero rechazarlo aquí evita una consulta innecesaria y un mensaje de error más claro. */
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string, metadata: ArgumentMetadata): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(
        `${metadata.data ?? 'El parámetro'} debe ser un entero positivo.`,
      );
    }
    return parsed;
  }
}
