import { RolUsuario } from '../database/entities';

/** Nunca se expone la entidad cruda (passwordHash, totpSecreto, id_usuario, etc.). */
export interface MeResponse {
  nombre: string;
  correo: string;
  rol: RolUsuario;
  fechaRegistro: string;
  totpActivo: boolean;
}
