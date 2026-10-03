import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';

export type TipoTokenVerificacion =
  'verificacion_correo' | 'recuperacion_password';

/**
 * Refleja la tabla Token_verificacion. token_hash es
 * HMAC-SHA256(CODE_HMAC_KEY, id_usuario:tipo:codigo), nunca el código en claro.
 */
@Entity('Token_verificacion')
@Index('idx_token_usuario_tipo', ['idUsuario', 'tipo'])
export class TokenVerificacion {
  @PrimaryGeneratedColumn({ name: 'id_token', type: 'int' })
  idToken!: number;

  @Column({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario;

  @Column({ name: 'tipo', type: 'varchar', length: 30 })
  tipo!: TipoTokenVerificacion;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'intentos', type: 'smallint', default: 0 })
  intentos!: number;

  @Column({ name: 'expira_en', type: 'datetime' })
  expiraEn!: Date;

  @Column({ name: 'usado_en', type: 'datetime', nullable: true })
  usadoEn!: Date | null;

  @Column({
    name: 'fecha_creacion',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaCreacion!: Date;
}
