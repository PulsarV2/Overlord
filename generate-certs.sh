#!/bin/bash
# Generate self-signed TLS certificates for Overlord
# For production, use proper certificates from Let's Encrypt or your CA

set -e

CERT_DIR="./certs"
DAYS=3650  # 10 years
COUNTRY="US"
STATE="State"
CITY="City"
ORG="Overlord"
ORG_UNIT="IT"
COMMON_NAME="${1:-localhost}"

echo "========================================="
echo "Generating TLS Certificates for Overlord"
echo "========================================="
echo "Common Name: $COMMON_NAME"
echo "Certificate Directory: $CERT_DIR"
echo "Validity: $DAYS days"
echo ""

# Create certs directory if it doesn't exist
mkdir -p "$CERT_DIR"

# Generate private key
echo "[1/3] Generating private key..."
openssl genrsa -out "$CERT_DIR/server.key" 2048

# Generate certificate signing request (CSR)
echo "[2/3] Generating certificate signing request..."
openssl req -new \
  -key "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.csr" \
  -subj "/C=$COUNTRY/ST=$STATE/L=$CITY/O=$ORG/OU=$ORG_UNIT/CN=$COMMON_NAME"

# Generate self-signed certificate with SAN (Subject Alternative Names)
echo "[3/3] Generating self-signed certificate..."
cat > "$CERT_DIR/san.cnf" << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
C=$COUNTRY
ST=$STATE
L=$CITY
O=$ORG
OU=$ORG_UNIT
CN=$COMMON_NAME

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = $COMMON_NAME
DNS.2 = localhost
DNS.3 = *.local
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

# Add additional IP if provided as second argument
if [ -n "$2" ]; then
    echo "IP.3 = $2" >> "$CERT_DIR/san.cnf"
    echo "Added IP: $2"
fi

openssl x509 -req \
  -in "$CERT_DIR/server.csr" \
  -signkey "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -days $DAYS \
  -sha256 \
  -extfile "$CERT_DIR/san.cnf" \
  -extensions req_ext

# Clean up CSR and config
rm "$CERT_DIR/server.csr" "$CERT_DIR/san.cnf"

# Set permissions
chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"

echo ""
echo "========================================="
echo "✓ Certificates generated successfully!"
echo "========================================="
echo "Certificate: $CERT_DIR/server.crt"
echo "Private Key: $CERT_DIR/server.key"
echo ""
echo "To use these certificates:"
echo "  1. Set environment variable: OVERLORD_TLS=true"
echo "  2. Optionally set custom paths:"
echo "     OVERLORD_TLS_CERT=$CERT_DIR/server.crt"
echo "     OVERLORD_TLS_KEY=$CERT_DIR/server.key"
echo ""
echo "⚠️  NOTE: Self-signed certificates require clients to:"
echo "  - Skip certificate verification (insecure), OR"
echo "  - Trust the server.crt certificate manually"
echo ""
echo "For production, use proper certificates from:"
echo "  - Let's Encrypt (free, automated)"
echo "  - Your organization's certificate authority"
echo "========================================="
