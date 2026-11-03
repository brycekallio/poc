#!/usr/bin/env bash
# Creates a free, self-signed code-signing certificate called "POC Dev" in its own small keychain, once.
# Why: macOS remembers the Accessibility permission by the app's signature. Ad-hoc signatures change on
# every build, so without this you would re-grant Accessibility after every rebuild. This costs nothing
# and is not an Apple Developer account; other Macs will not trust it (the app is for your own Mac).
set -euo pipefail
NAME="POC Dev"
KC="$HOME/Library/Keychains/poc-dev.keychain-db"
PW=poc-dev   # protects nothing but a throwaway signing key that only signs this one local app
if [ -f "$KC" ] && security find-identity -p codesigning "$KC" | grep -q "\"$NAME\""; then echo "'$NAME' already exists."; exit 0; fi
DIR="$(mktemp -d)"; trap 'rm -rf "$DIR"' EXIT
cat > "$DIR/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -config "$DIR/cert.cnf" 2>/dev/null
openssl pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" -out "$DIR/id.p12" -passout pass:poc -legacy 2>/dev/null \
  || openssl pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" -out "$DIR/id.p12" -passout pass:poc
[ -f "$KC" ] || security create-keychain -p "$PW" "$KC"
security set-keychain-settings "$KC"            # never auto-lock
security unlock-keychain -p "$PW" "$KC"
security import "$DIR/id.p12" -k "$KC" -P poc -T /usr/bin/codesign >/dev/null
# Let codesign use the key without a dialog (a GUI prompt would hang scripted builds).
security set-key-partition-list -S apple-tool:,apple: -s -k "$PW" "$KC" >/dev/null
# Put it on the keychain search list so codesign can find it by name.
security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')
echo "Created '$NAME' in $KC."
