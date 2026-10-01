import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Refleja la tabla Plataforma. Los registros no se borran, se desactivan (activa = FALSE). */
@Entity('Plataforma')
export class Plataforma {
  @PrimaryGeneratedColumn({ name: 'id_plataforma', type: 'int' })
  idPlataforma!: number;

  @Column({ name: 'nombre', type: 'varchar', length: 100 })
  nombre!: string;

  @Column({ name: 'es_otra', type: 'boolean', default: false })
  esOtra!: boolean;

  @Column({ name: 'activa', type: 'boolean', default: true })
  activa!: boolean;
}
