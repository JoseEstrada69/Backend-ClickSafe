import { Matches } from 'class-validator';

export class MfaEnableDto {
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  codigo!: string;
}
