#!/usr/bin/env bash
set -euo pipefail

# Genera una CA propia y el certificado del servidor de ClickSafe para el
# laboratorio (docs/despliegue.md — TLS con certificado propio, sin un
# proveedor externo). Corre este script UNA vez, en tu máquina (no en el
# servidor), y copia los archivos de salida a donde indica despliegue.md.
#
# Uso:
#   SERVER_IP=10.0.20.10 ./generate-ca.sh
#   SERVER_IP=10.0.20.10 SERVER_NAME=clicksafe.lab ./generate-ca.sh
#
# SERVER_IP es obligatorio: tiene que ser la IP real de la PC del backend
# en el laboratorio. Sin un Subject Alternative Name con esa IP, iOS y los
# navegadores modernos rechazan el certificado aunque la CA sea de
# confianza (ya no basta con el Common Name).

SERVER_IP="${SERVER_IP:?Define SERVER_IP, p. ej.: SERVER_IP=10.0.20.10 ./generate-ca.sh}"
SERVER_NAME="${SERVER_NAME:-clicksafe.lab}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/out"
DAYS_CA=3650
DAYS_SERVER=825 # límite que aceptan iOS/macOS para certificados de hoja

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "==> Generando la CA (ClickSafe Lab Root CA)..."
openssl genrsa -out clicksafe-ca.key 4096
openssl req -x509 -new -nodes \
  -key clicksafe-ca.key \
  -sha256 -days "$DAYS_CA" \
  -subj "/O=ClickSafe Laboratorio/CN=ClickSafe Lab Root CA" \
  -out clicksafe-ca.pem

echo "==> Generando la llave y el CSR del servidor ($SERVER_NAME / $SERVER_IP)..."
openssl genrsa -out clicksafe.key 2048

cat > server.cnf <<EOF
[req]
distinguished_name = dn
req_extensions = ext
prompt = no

[dn]
O = ClickSafe Laboratorio
CN = $SERVER_NAME

[ext]
subjectAltName = @alt_names
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = $SERVER_NAME
IP.1 = $SERVER_IP
EOF

openssl req -new -key clicksafe.key -out clicksafe.csr -config server.cnf

echo "==> Firmando el certificado del servidor con la CA..."
openssl x509 -req \
  -in clicksafe.csr \
  -CA clicksafe-ca.pem -CAkey clicksafe-ca.key -CAcreateserial \
  -days "$DAYS_SERVER" -sha256 \
  -extfile server.cnf -extensions ext \
  -out clicksafe.crt

cat clicksafe.crt clicksafe-ca.pem > fullchain.pem
rm -f clicksafe.csr server.cnf clicksafe-ca.srl

echo
echo "Listo. Archivos en $OUT_DIR (ninguno se versiona: *.pem/*.key/*.crt están en .gitignore):"
echo "  clicksafe-ca.pem  -> CA raíz. Instálala como 'de confianza' en cada dispositivo de prueba"
echo "                       (simulador/iPhone, navegador) — ver docs/despliegue.md."
echo "  clicksafe-ca.key  -> llave privada de la CA. NO la copies al servidor; guárdala aparte."
echo "  clicksafe.key     -> llave privada del servidor -> /etc/nginx/ssl/clicksafe/clicksafe.key"
echo "  fullchain.pem     -> certificado del servidor + CA -> /etc/nginx/ssl/clicksafe/fullchain.pem"
