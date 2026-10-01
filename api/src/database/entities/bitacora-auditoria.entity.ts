import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';

export type ResultadoAuditoria = 'exito' | 'fallo';

/**
 * Refleja la tabla Bitacora_auditoria. El usuario de BD de la API solo tiene
 * SELECT e INSERT aquí (sección 6 del .sql): ni esta entidad ni AuditService
 * deben borrar ni actualizar filas.
 */
@Entity('Bitacora_auditoria')
@Index('idx_bitacora_accion', ['accion', 'fecha'])
@Index('idx_bitacora_usuario', ['idUsuario', 'fecha'])
export class BitacoraAuditoria {
  @PrimaryGeneratedColumn({ name: 'id_evento', type: 'bigint' })
  idEvento!: string;

  @Index('idx_bitacora_fecha')
  @Column({
    name: 'fecha',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  fecha!: Date;

  @Column({ name: 'id_usuario', type: 'int', nullable: true })
  idUsuario!: number | null;

  @ManyToOne(() => Usuario, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario | null;

  @Column({ name: 'accion', type: 'varchar', length: 60 })
  accion!: string;

  @Column({ name: 'resultado', type: 'varchar', length: 10 })
  resultado!: ResultadoAuditoria;

  @Column({ name: 'recurso_tipo', type: 'varchar', length: 30, nullable: true })
  recursoTipo!: string | null;

  @Column({ name: 'recurso_id', type: 'int', nullable: true })
  recursoId!: number | null;

  @Column({ name: 'ip', type: 'varchar', length: 45, nullable: true })
  ip!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  /** NUNCA debe contener contraseñas, tokens ni secretos (sección 4.6). */
  @Column({ name: 'detalle', type: 'json', nullable: true })
  detalle!: Record<string, unknown> | null;
}
