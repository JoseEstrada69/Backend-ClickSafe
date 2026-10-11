/**
 * Escapa `%`, `_` y `\` antes de usar un texto dentro de un LIKE
 * parametrizado (4.7). Sin esto, un usuario podría mandar `q=%` y forzar un
 * table scan, o `_` para hacer coincidir cualquier carácter — no es
 * inyección SQL (el valor sigue parametrizado), pero sí abuso del propio
 * operador LIKE.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
