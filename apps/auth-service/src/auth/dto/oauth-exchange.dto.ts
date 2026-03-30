import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OauthExchangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  oauthCode!: string;
}
