import { IsIn, IsString, Length } from 'class-validator';
import type { OtpChannel } from '../otp.js';

export class RequestOtpDto {
  @IsIn(['email', 'phone'])
  channel!: OtpChannel;

  @IsString()
  @Length(3, 254)
  identifier!: string;
}
