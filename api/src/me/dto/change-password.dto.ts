import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @Length(1, 128)
  passwordActual!: string;

  @IsString()
  @Length(8, 128)
  nuevaPassword!: string;
}
