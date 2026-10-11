import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '../config/config.module';
import { CaptchaUsado } from '../database/entities';
import { CaptchaService } from './captcha.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([CaptchaUsado])],
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
