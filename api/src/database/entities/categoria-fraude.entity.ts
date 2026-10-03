import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Refleja la tabla Categoria_fraude. */
@Entity('Categoria_fraude')
export class CategoriaFraude {
  @PrimaryGeneratedColumn({ name: 'id_categoria', type: 'int' })
  idCategoria!: number;

  @Column({ name: 'nombre', type: 'varchar', length: 100 })
  nombre!: string;

  @Column({ name: 'descripcion', type: 'varchar', length: 255, nullable: true })
  descripcion!: string | null;

  @Column({ name: 'activa', type: 'boolean', default: true })
  activa!: boolean;
}
