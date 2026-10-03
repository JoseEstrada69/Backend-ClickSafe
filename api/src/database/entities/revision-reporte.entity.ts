import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Reporte } from './reporte.entity';
import { Usuario } from './usuario.entity';

export type DecisionRevision = 'validado' | 'rechazado';

/** Refleja la tabla Revision_reporte. Un admin no puede revisar un reporte propio (separación de funciones). */
@Entity('Revision_reporte')
export class RevisionReporte {
  @PrimaryGeneratedColumn({ name: 'id_revision', type: 'int' })
  idRevision!: number;

  @Column({ name: 'id_reporte', type: 'int' })
  idReporte!: number;

  @ManyToOne(() => Reporte, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_reporte' })
  reporte!: Reporte;

  @Column({ name: 'id_administrador', type: 'int' })
  idAdministrador!: number;

  @ManyToOne(() => Usuario, { onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_administrador' })
  administrador!: Usuario;

  @Column({ name: 'decision', type: 'varchar', length: 20 })
  decision!: DecisionRevision;

  @Column({ name: 'comentario', type: 'varchar', length: 500, nullable: true })
  comentario!: string | null;

  @Column({
    name: 'fecha_revision',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaRevision!: Date;
}
