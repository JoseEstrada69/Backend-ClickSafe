/** Detecta una violación de llave única/primaria de MySQL (ER_DUP_ENTRY), para tratar un INSERT duplicado como "ya existía" en vez de propagar el error (p. ej. likes/denuncias idempotentes). */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
  );
}
