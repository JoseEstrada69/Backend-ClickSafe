import { IsString, Length } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @Length(1, 100)
  nombre!: string;
}
