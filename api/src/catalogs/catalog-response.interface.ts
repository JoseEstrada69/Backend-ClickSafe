export interface PlatformResponse {
  id: number;
  nombre: string;
  esOtra: boolean;
}

export interface CategoryResponse {
  id: number;
  nombre: string;
  descripcion: string | null;
}
