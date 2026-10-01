import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';

/**
 * Refleja la tabla Sesion. Cada fila es un refresh token (rotación con
 * detección de reuso, 5.6 de CLAUDE.md). token_hash es SHA-256 del token
 * real; el token en claro nunca se guarda.
 */
@Entity('Sesion')
@Index('idx_sesion_usuario', ['idUsuario', 'revocadaEn'])
export class Sesion {
  @PrimaryGeneratedColumn({ name: 'id_sesion', type: 'int' })
  idSesion!: number;

  @Column({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario;

  @Index('idx_sesion_familia')
  @Column({ name: 'familia', type: 'char', length: 36 })
  familia!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'expira_en', type: 'datetime' })
  expiraEn!: Date;

  @Column({ name: 'expira_absoluta', type: 'datetime' })
  expiraAbsoluta!: Date;

  @Column({ name: 'reemplazada_en', type: 'datetime', nullable: true })
  reemplazadaEn!: Date | null;

  @Column({ name: 'revocada_en', type: 'datetime', nullable: true })
  revocadaEn!: Date | null;

  @Column({ name: 'ip', type: 'varchar', length: 45, nullable: true })
  ip!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @Column({
    name: 'fecha_creacion',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaCreacion!: Date;
}
