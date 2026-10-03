import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type RolUsuario = 'usuario' | 'admin';

/** Refleja la tabla Usuario de database/clicksafe_db.sql — no renombrar columnas. */
@Entity('Usuario')
export class Usuario {
  @PrimaryGeneratedColumn({ name: 'id_usuario', type: 'int' })
  idUsuario!: number;

  @Column({ name: 'nombre', type: 'varchar', length: 100 })
  nombre!: string;

  @Column({ name: 'correo', type: 'varchar', length: 254 })
  correo!: string;

  @Column({ name: 'correo_verificado', type: 'boolean', default: false })
  correoVerificado!: boolean;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'rol', type: 'varchar', length: 20, default: 'usuario' })
  rol!: RolUsuario;

  @Column({ name: 'activo', type: 'boolean', default: true })
  activo!: boolean;

  @Column({ name: 'intentos_fallidos', type: 'smallint', default: 0 })
  intentosFallidos!: number;

  @Column({ name: 'bloqueado_hasta', type: 'datetime', nullable: true })
  bloqueadoHasta!: Date | null;

  /** Cifrado con AES-256-GCM (TOTP_ENCRYPTION_KEY) antes de guardarse. Nunca en claro. */
  @Column({
    name: 'totp_secreto',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  totpSecreto!: string | null;

  @Column({ name: 'totp_activo', type: 'boolean', default: false })
  totpActivo!: boolean;

  @Column({ name: 'totp_ultimo_contador', type: 'bigint', nullable: true })
  totpUltimoContador!: string | null;

  @Column({
    name: 'fecha_registro',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaRegistro!: Date;

  @Column({
    name: 'fecha_actualizacion',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  fechaActualizacion!: Date;
}
