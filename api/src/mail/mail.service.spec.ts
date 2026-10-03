import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MailService } from './mail.service';

const sendMailMock = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

describe('MailService', () => {
  let service: MailService;
  let appConfig: AppConfigService;

  beforeEach(() => {
    sendMailMock.mockReset().mockResolvedValue(undefined);
    appConfig = {
      mail: {
        host: '127.0.0.1',
        port: 1025,
        from: 'ClickSafe <no-reply@clicksafe.local>',
      },
    } as unknown as AppConfigService;

    service = new MailService(appConfig, {
      setContext: jest.fn(),
    } as unknown as PinoLogger);
    service.onModuleInit();
  });

  it('envía el correo con el remitente configurado', async () => {
    await service.send({
      to: 'persona@example.com',
      subject: 'Hola',
      text: 'Cuerpo',
    });

    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'ClickSafe <no-reply@clicksafe.local>',
      to: 'persona@example.com',
      subject: 'Hola',
      text: 'Cuerpo',
      html: undefined,
    });
  });
});
