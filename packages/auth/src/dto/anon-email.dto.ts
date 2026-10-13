import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RequestAnonEmailDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ConfirmAnonEmailDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
