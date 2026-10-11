import { IsEmail, Matches, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @IsEmail()
  @MaxLength(254)
  correo!: string;

  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  codigo!: string;
}
