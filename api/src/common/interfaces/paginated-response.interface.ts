/** Forma común de todo listado paginado (sección 7). */
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
