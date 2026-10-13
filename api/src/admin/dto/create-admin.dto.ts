import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';

/**
 * POST /admin/admins (sección 7/8): `totp` es el código del admin que llama
 * (reautenticación), no del admin nuevo — separación de funciones, igual
 * que /auth/2fa/enable. El nuevo admin recibe un código de recuperación
 * por correo para definir su propia contraseña, nunca una elegida por otro.
 */
export class CreateAdminDto {
  @Trim()
  @IsString()
  @Length(1, 100)
  @IsNoControlChars()
  nombre!: string;

  @IsEmail()
  @MaxLength(254)
  correo!: string;

  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  totp!: string;
}
