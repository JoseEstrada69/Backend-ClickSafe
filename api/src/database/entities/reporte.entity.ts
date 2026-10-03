import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CategoriaFraude } from './categoria-fraude.entity';
import { Plataforma } from './plataforma.entity';
import { Usuario } from './usuario.entity';

export type EstadoReporte = 'pendiente' | 'validado' | 'rechazado';

/**
 * Refleja la tabla Reporte. total_likes se actualiza en la misma transacción
 * que inserta/borra en Like_reporte (nunca calculado en Node, sección 7).
 */
@Entity('Reporte')
@Index('idx_reporte_fecha', ['fechaCreacion'])
@Index('idx_reporte_likes', ['totalLikes', 'fechaCreacion'])
@Index('idx_reporte_estado', ['estado', 'fechaCreacion'])
export class Reporte {
  @PrimaryGeneratedColumn({ name: 'id_reporte', type: 'int' })
  idReporte!: number;

  @Column({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @ManyToOne(() => Usuario, { onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario;

  @Column({ name: 'id_plataforma', type: 'int' })
  idPlataforma!: number;

  @ManyToOne(() => Plataforma, { onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_plataforma' })
  plataforma!: Plataforma;

  @Column({
    name: 'plataforma_otra',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  plataformaOtra!: string | null;

  @Column({ name: 'id_categoria', type: 'int' })
  idCategoria!: number;

  @ManyToOne(() => CategoriaFraude, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'id_categoria' })
  categoria!: CategoriaFraude;

  @Column({ name: 'titulo', type: 'varchar', length: 150 })
  titulo!: string;

  @Column({ name: 'descripcion', type: 'text' })
  descripcion!: string;

  /** El servidor NUNCA hace peticiones a esta URL (prevención de SSRF, 4.8). */
  @Column({ name: 'url_publicacion', type: 'varchar', length: 2048 })
  urlPublicacion!: string;

  @Column({ name: 'anonimo', type: 'boolean', default: false })
  anonimo!: boolean;

  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'pendiente' })
  estado!: EstadoReporte;

  @Column({ name: 'total_likes', type: 'int', default: 0 })
  totalLikes!: number;

  @Column({
    name: 'fecha_creacion',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaCreacion!: Date;

  @Column({
    name: 'fecha_actualizacion',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  fechaActualizacion!: Date;
}
