import { IsEmail, IsString, MaxLength } from 'class-validator';

export class ResendVerificationDto {
  @IsEmail()
  @MaxLength(254)
  correo!: string;

  @IsString()
  captcha!: string;
}
