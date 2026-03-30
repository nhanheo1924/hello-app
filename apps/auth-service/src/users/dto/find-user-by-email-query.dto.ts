import { IsEmail } from 'class-validator';

export class FindUserByEmailQueryDto {
  @IsEmail()
  email!: string;
}
