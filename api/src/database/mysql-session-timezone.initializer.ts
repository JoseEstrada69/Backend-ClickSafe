import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Pool, PoolConnection } from 'mysql2';

const SESSION_TIME_ZONE_SQL = "SET time_zone = '+00:00'";

/**
 * La opción `timezone: 'Z'` de TypeORM (ver database.module.ts) solo le dice
 * al driver cómo convertir un `Date` de JS a un DATETIME de MySQL y
 * viceversa; NO cambia la zona horaria de la SESIÓN de MySQL. Por eso
 * columnas con `DEFAULT CURRENT_TIMESTAMP` (fecha_creacion, etc.), que las
 * llena el propio MySQL con NOW(), seguían usando la hora local del sistema
 * en vez de UTC (6), aunque las columnas que llena la API con `new Date()`
 * (expira_en, etc.) siempre estuvieron en UTC.
 *
 * No podemos arreglarlo con `SET GLOBAL time_zone` (compartido con otros
 * proyectos en el mismo MySQL, 6), así que lo fijamos por CONEXIÓN del pool:
 * cada conexión nueva ejecuta `SET time_zone = '+00:00'` en cuanto se abre.
 *
 * mysql2 abre la primera conexión del pool de forma inmediata al conectar
 * (TypeORM hace un `getConnection()` + `release()` de prueba dentro de
 * `connect()`, antes de que este provider pueda suscribirse a nada), así
 * que hay que cubrir dos casos:
 *   1. Esa primera conexión: se corrige con una query directa justo después
 *      de que TypeORM termina de inicializar el DataSource.
 *   2. Cualquier conexión adicional que el pool abra después (bajo carga
 *      concurrente): se corrige con el evento 'connection' del pool.
 */
@Injectable()
export class MysqlSessionTimezoneInitializer implements OnModuleInit {
  private readonly logger = new Logger(MysqlSessionTimezoneInitializer.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    const pool = (this.dataSource.driver as unknown as { pool?: Pool }).pool;
    if (!pool) {
      throw new Error(
        'No se encontró el pool de MySQL: no se pudo fijar time_zone de la sesión a UTC.',
      );
    }

    pool.on('connection', (connection: PoolConnection) => {
      connection.query(SESSION_TIME_ZONE_SQL, (error) => {
        if (error) {
          // No tumbamos una app ya corriendo por esto, pero sí lo gritamos:
          // significa que esa conexión seguirá usando la hora local de
          // MySQL para CURRENT_TIMESTAMP/NOW() (6).
          this.logger.error(
            `No se pudo fijar time_zone='+00:00' en una conexión nueva del pool: ${String(error)}`,
          );
        }
      });
    });

    // Corrige la conexión que TypeORM ya abrió y liberó durante connect().
    await this.dataSource.query(SESSION_TIME_ZONE_SQL);
  }
}
