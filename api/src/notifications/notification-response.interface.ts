import type { TipoNotificacion } from '../database/entities';

export interface NotificationResponse {
  id: number;
  tipo: TipoNotificacion;
  mensaje: string;
  leida: boolean;
  reporteId: number;
  fechaCreacion: string;
}
