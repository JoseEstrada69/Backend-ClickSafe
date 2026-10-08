#!/usr/bin/env node
/**
 * Candado de arranque rápido para `npm run test:e2e` (7): antes de levantar
 * Jest siquiera, confirma que exista api/.env.test y que apunte a
 * DB_NAME=clicksafe_test. El candado real e inevitable está en
 * src/config/env.schema.ts (la API no arranca si NODE_ENV=test y DB_NAME no
 * es clicksafe_test); este script solo da un error más rápido y más claro,
 * antes de que Jest intente compilar nada.
 */
const fs = require('node:fs');
const path = require('node:path');

const envTestPath = path.join(__dirname, '..', '.env.test');
const REQUIRED_DB_NAME = 'clicksafe_test';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(envTestPath)) {
  fail(
    'Falta api/.env.test. Cópialo de api/.env.test.example y configúralo ' +
      'contra la base clicksafe_test (ver README, sección "Base de datos ' +
      'para las pruebas e2e"). Las pruebas e2e nunca deben correr contra ' +
      'la base de desarrollo.',
  );
}

const lines = fs.readFileSync(envTestPath, 'utf8').split(/\r?\n/);
let dbName;
for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#') || trimmed.length === 0) continue;
  const [key, ...rest] = trimmed.split('=');
  if (key === 'DB_NAME') {
    dbName = rest.join('=').trim();
  }
}

if (dbName !== REQUIRED_DB_NAME) {
  fail(
    `api/.env.test tiene DB_NAME=${dbName ?? '(vacío)'}, pero debe ser ` +
      `exactamente "${REQUIRED_DB_NAME}". No se corre test:e2e para no ` +
      'arriesgar escribir datos de prueba en la base equivocada.',
  );
}

console.log(`✓ api/.env.test apunta a ${REQUIRED_DB_NAME}. Corriendo test:e2e...`);
