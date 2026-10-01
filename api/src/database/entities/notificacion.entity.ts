import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Reporte } from './reporte.entity';
import { Usuario } from './usuario.entity';

export type TipoNotificacion =
  | 'reporte_validado'
  | 'reporte_rechazado'
  | 'nuevo_comentario'
  | 'comentario_ocultado';

/**
 * Refleja la tabla Notificacion. Si la notificación viene de un comentario
 * anónimo, `mensaje` NUNCA debe incluir el nombre del autor (lo controla la API).
 */
@Entity('Notificacion')
@Index('idx_notificacion_usuario', ['idUsuario', 'leida', 'fechaCreacion'])
export class Notificacion {
  @PrimaryGeneratedColumn({ name: 'id_notificacion', type: 'int' })
  idNotificacion!: number;

  @Column({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario;

  @Column({ name: 'id_reporte', type: 'int' })
  idReporte!: number;

  @ManyToOne(() => Reporte, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_reporte' })
  reporte!: Reporte;

  @Column({ name: 'tipo', type: 'varchar', length: 30 })
  tipo!: TipoNotificacion;

  @Column({ name: 'mensaje', type: 'varchar', length: 255 })
  mensaje!: string;

  @Column({ name: 'leida', type: 'boolean', default: false })
  leida!: boolean;

  @Column({
    name: 'fecha_creacion',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaCreacion!: Date;
}
