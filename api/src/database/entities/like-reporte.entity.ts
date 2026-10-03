import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Reporte } from './reporte.entity';
import { Usuario } from './usuario.entity';

/**
 * Refleja la tabla Like_reporte. La PK compuesta (id_usuario, id_reporte)
 * hace que la propia BD impida un segundo like aunque lleguen dos
 * peticiones simultáneas (la API no alcanzaría a detectar esa carrera).
 */
@Entity('Like_reporte')
export class LikeReporte {
  @PrimaryColumn({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_usuario' })
  usuario!: Usuario;

  @Index('idx_like_reporte')
  @PrimaryColumn({ name: 'id_reporte', type: 'int' })
  idReporte!: number;

  @ManyToOne(() => Reporte, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_reporte' })
  reporte!: Reporte;

  @Column({
    name: 'fecha_like',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaLike!: Date;
}
