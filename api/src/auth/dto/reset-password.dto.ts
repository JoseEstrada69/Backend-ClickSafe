import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @MaxLength(254)
  correo!: string;

  @Matches(/^\d{8}$/, { message: 'El código debe tener 8 dígitos.' })
  codigo!: string;

  @IsString()
  @Length(8, 128)
  nuevaPassword!: string;

  @IsString()
  captcha!: string;
}
