import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Refleja la tabla Captcha_usado. La firma HMAC del reto ya resuelto es la
 * propia PK: evita reutilizar un captcha resuelto (ataque de repetición).
 */
@Entity('Captcha_usado')
export class CaptchaUsado {
  @PrimaryColumn({ name: 'firma', type: 'char', length: 64 })
  firma!: string;

  @Index('idx_captcha_expira')
  @Column({ name: 'expira_en', type: 'datetime' })
  expiraEn!: Date;
}
