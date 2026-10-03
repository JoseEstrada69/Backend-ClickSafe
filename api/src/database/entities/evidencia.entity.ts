import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Reporte } from './reporte.entity';

export type TipoArchivoEvidencia = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Refleja la tabla Evidencia. nombre_archivo y ruta_archivo son generados
 * por la API (uuid v4 + extensión), nunca el nombre que manda el cliente
 * (sección 6).
 */
@Entity('Evidencia')
export class Evidencia {
  @PrimaryGeneratedColumn({ name: 'id_evidencia', type: 'int' })
  idEvidencia!: number;

  @Column({ name: 'id_reporte', type: 'int' })
  idReporte!: number;

  @ManyToOne(() => Reporte, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'id_reporte' })
  reporte!: Reporte;

  @Column({ name: 'nombre_archivo', type: 'varchar', length: 64 })
  nombreArchivo!: string;

  @Column({ name: 'ruta_archivo', type: 'varchar', length: 500 })
  rutaArchivo!: string;

  @Column({ name: 'tipo_archivo', type: 'varchar', length: 50 })
  tipoArchivo!: TipoArchivoEvidencia;

  @Column({ name: 'tamano_bytes', type: 'int' })
  tamanoBytes!: number;

  @Column({ name: 'hash_sha256', type: 'char', length: 64 })
  hashSha256!: string;

  @Column({
    name: 'fecha_subida',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaSubida!: Date;
}
