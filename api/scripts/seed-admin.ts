import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { AppConfigService } from '../src/config/app-config.service';
import { Usuario } from '../src/database/entities';
import { generateStrongPassword } from '../src/common/utils/generate-strong-password';
import { hashPassword } from '../src/common/utils/password-hash';

/**
 * npm run seed:admin (sección 8). Crea el primer admin con una contraseña
 * aleatoria mostrada UNA sola vez en consola (nunca escrita a un archivo).
 * Si ya existe cualquier admin, no hace nada: no hay forma de que este
 * script reemplace o duplique admins existentes.
 */
async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const appConfig = app.get(AppConfigService);
    const { nombre, correo } = appConfig.seedAdmin;

    if (!nombre || !correo) {
      console.error(
        'Faltan SEED_ADMIN_NOMBRE y/o SEED_ADMIN_CORREO en el entorno. No se creó ningún admin.',
      );
      process.exitCode = 1;
      return;
    }

    const usuarioRepo = app.get<Repository<Usuario>>(
      getRepositoryToken(Usuario),
    );
    const auditService = app.get(AuditService);

    const existingAdmin = await usuarioRepo.findOne({
      where: { rol: 'admin' },
    });
    if (existingAdmin) {
      console.log('Ya existe al menos un admin. No se creó ninguno.');
      return;
    }

    const correoNormalizado = correo.trim().toLowerCase();
    const password = generateStrongPassword(24);
    const passwordHash = await hashPassword(password);

    const admin = usuarioRepo.create({
      nombre,
      correo: correoNormalizado,
      correoVerificado: true,
      passwordHash,
      rol: 'admin',
    });
    const saved = await usuarioRepo.save(admin);

    await auditService.log({
      idUsuario: saved.idUsuario,
      accion: 'admin_creado',
      resultado: 'exito',
      recursoTipo: 'Usuario',
      recursoId: saved.idUsuario,
      detalle: { via: 'seed' },
    });

    console.log('Admin creado correctamente:');
    console.log(`  Correo:      ${saved.correo}`);
    console.log(`  Contraseña:  ${password}`);
    console.log(
      '  (Esta contraseña solo se muestra aquí. Guárdala ahora; en el primer login deberá configurar 2FA.)',
    );
  } finally {
    await app.close();
  }
}

void run();
