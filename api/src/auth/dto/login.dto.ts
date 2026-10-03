import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  correo!: string;

  @IsString()
  @Length(1, 128)
  password!: string;

  @IsString()
  captcha!: string;
}
