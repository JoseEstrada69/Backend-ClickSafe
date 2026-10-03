import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Comentario } from './comentario.entity';
import { Usuario } from './usuario.entity';

export type MotivoDenuncia =
  'spam' | 'acoso' | 'lenguaje_ofensivo' | 'informacion_personal' | 'otro';

/**
 * Refleja la tabla Denuncia_comentario. UNIQUE(id_comentario, id_usuario):
 * un usuario solo puede denunciar un comentario una vez.
 */
@Entity('Denuncia_comentario')
@Index('uq_denuncia_usuario', ['idComentario', 'idUsuario'], { unique: true })
@Index('idx_denuncia_pendientes', ['resuelta', 'fechaDenuncia'])
export class DenunciaComentario {
  @PrimaryGeneratedColumn({ name: 'id_denuncia', type: 'int' })
  idDenuncia!: number;

  @Column({ name: 'id_comentario', type: 'int' })
  idComentario!: number;

  @ManyToOne(() => Comentario, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_comentario' })
  comentario!: Comentario;

  @Column({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario;

  @Column({ name: 'motivo', type: 'varchar', length: 30 })
  motivo!: MotivoDenuncia;

  @Column({ name: 'detalle', type: 'varchar', length: 255, nullable: true })
  detalle!: string | null;

  @Column({ name: 'resuelta', type: 'boolean', default: false })
  resuelta!: boolean;

  @Column({
    name: 'fecha_denuncia',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaDenuncia!: Date;
}
