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

export type EstadoComentario =
  'visible' | 'oculto_auto' | 'oculto_admin' | 'eliminado';

/**
 * Refleja la tabla Comentario. No hay columna de edición: los comentarios
 * no se pueden editar, solo borrar (borrado lógico, estado = 'eliminado').
 * total_denuncias cuenta solo denuncias NO resueltas.
 */
@Entity('Comentario')
@Index('idx_comentario_reporte', ['idReporte', 'estado', 'fechaCreacion'])
@Index('idx_comentario_usuario', ['idUsuario', 'fechaCreacion'])
@Index('idx_comentario_moderacion', ['estado', 'totalDenuncias'])
export class Comentario {
  @PrimaryGeneratedColumn({ name: 'id_comentario', type: 'int' })
  idComentario!: number;

  @Column({ name: 'id_reporte', type: 'int' })
  idReporte!: number;

  @ManyToOne(() => Reporte, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_reporte' })
  reporte!: Reporte;

  @Column({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @ManyToOne(() => Usuario, { onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario;

  @Column({ name: 'contenido', type: 'varchar', length: 1000 })
  contenido!: string;

  @Column({ name: 'anonimo', type: 'boolean', default: false })
  anonimo!: boolean;

  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'visible' })
  estado!: EstadoComentario;

  @Column({ name: 'total_denuncias', type: 'int', default: 0 })
  totalDenuncias!: number;

  @Column({ name: 'id_moderador', type: 'int', nullable: true })
  idModerador!: number | null;

  @ManyToOne(() => Usuario, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'id_moderador' })
  moderador!: Usuario | null;

  @Column({ name: 'fecha_moderacion', type: 'datetime', nullable: true })
  fechaModeracion!: Date | null;

  @Column({
    name: 'fecha_creacion',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaCreacion!: Date;
}
