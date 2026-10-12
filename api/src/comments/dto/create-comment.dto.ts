import { IsBoolean, IsString, Length } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator';
import { IsNoControlChars } from '../../common/validators/no-control-chars.validator';

export class CreateCommentDto {
  @Trim()
  @IsString()
  @Length(1, 1000)
  @IsNoControlChars({ allowNewline: true })
  contenido!: string;

  @IsBoolean()
  anonimo!: boolean;
}
