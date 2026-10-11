import { IsString, Matches, MinLength } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @MinLength(1)
  mfaToken!: string;

  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  codigo!: string;
}
