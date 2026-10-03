import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(1, 100)
  nombre!: string;

  @IsEmail()
  @MaxLength(254)
  correo!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  captcha!: string;
}
