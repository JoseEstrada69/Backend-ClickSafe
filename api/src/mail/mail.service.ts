import { Injectable, OnModuleInit } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Envía correo vía SMTP. En desarrollo apunta a Mailpit (sección 1, regla
 * 12): no se usan servicios externos. El transporte se crea una sola vez
 * y se reutiliza entre llamadas.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private transporter!: Transporter;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MailService.name);
  }

  onModuleInit(): void {
    this.transporter = createTransport({
      host: this.appConfig.mail.host,
      port: this.appConfig.mail.port,
      secure: false,
    });
  }

  async send(input: SendMailInput): Promise<void> {
    await this.transporter.sendMail({
      from: this.appConfig.mail.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }
}
