import { registerDecorator, ValidationOptions } from 'class-validator';

// eslint-disable-next-line no-control-regex -- justo lo que busca: bytes de control y nulos (4.7).
const CONTROL_CHARS_ALL = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex -- idem, permitiendo \n (0x0A) para texto largo.
const CONTROL_CHARS_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F]/;

/**
 * Rechaza bytes nulos y caracteres de control (4.7): previene que un campo
 * de texto lleve secuencias invisibles usadas para inyección en logs/CSV o
 * para confundir a quien revisa un reporte. `allowNewline` permite \n en
 * campos largos (descripción, comentarios); el resto (títulos, nombres) no.
 */
export function IsNoControlChars(
  validationOrOptions: ValidationOptions & { allowNewline?: boolean } = {},
): PropertyDecorator {
  const { allowNewline, ...validationOptions } = validationOrOptions;
  const pattern = allowNewline
    ? CONTROL_CHARS_EXCEPT_NEWLINE
    : CONTROL_CHARS_ALL;

  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isNoControlChars',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value !== 'string' || !pattern.test(value);
        },
        defaultMessage(): string {
          return 'No puede contener caracteres de control ni bytes nulos.';
        },
      },
    });
  };
}
