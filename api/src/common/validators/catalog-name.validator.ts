import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Nombres de Plataforma/Categoria_fraude: letras (con acentos y ñ/ü),
 * dígitos, espacios y la puntuación mínima que de verdad aparece en nombres
 * de tiendas o categorías reales (. , & - ' ( )). Lista blanca, no lista
 * negra: un escáner como OWASP ZAP (u otro fuzzing) ya demostró que la API
 * guardaba tal cual payloads de prueba (comillas, paréntesis, ';', 'chr(...)',
 * URLs) como "nombre" válido. No había inyección (los valores solo se
 * guardaban como texto), pero ensuciaban los catálogos que ve la app iOS.
 * Rechazar esos caracteres de entrada es más simple y más seguro que
 * intentar detectar después cuáles de los cientos de nombres son "basura".
 */
export const CATALOG_NAME_PATTERN = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9 .,&'()-]+$/;

export function IsCatalogName(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isCatalogName',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value !== 'string' || CATALOG_NAME_PATTERN.test(value);
        },
        defaultMessage(): string {
          return "Solo letras, dígitos, espacios y . , & - ' ( ).";
        },
      },
    });
  };
}
