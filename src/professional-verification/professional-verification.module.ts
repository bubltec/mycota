import { Module } from '@nestjs/common';
import { ProfessionalVerificationController } from './professional-verification.controller.js';
import { ProfessionalVerificationService } from './professional-verification.service.js';

// No `imports: [MycotaAuthModule]` needed — it's registered `global: true`
// by MycotaAuthModule.forRootAsync(), so UsersService/EmailCodeService and
// the guards/decorators used above are already available.
@Module({
  controllers: [ProfessionalVerificationController],
  providers: [ProfessionalVerificationService],
})
export class ProfessionalVerificationModule {}
