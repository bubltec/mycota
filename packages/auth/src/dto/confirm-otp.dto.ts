import { IsIn, IsString, Length, Matches } from 'class-validator';
import type { OtpChannel } from '../otp.js';

export class ConfirmOtpDto {
  @IsIn(['email', 'phone'])
  channel!: OtpChannel;

  @IsString()
  @Length(3, 254)
  identifier!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
