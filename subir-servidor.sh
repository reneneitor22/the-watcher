#!/bin/zsh
# subir-servidor.sh — copia el vigilante al servidor Linux, LIMPIO: sin la sesión, los mensajes,
# los adjuntos ni los grupos del número de MaxiTravel (el número de Navío empieza de cero).
#   ./subir-servidor.sh root@IP
# Sí lleva navio-clave.txt (va por ssh, igual que scp). Luego en el servidor: ver whats-lector.service.
set -e
cd "${0:A:h}"
[[ -z "$1" ]] && { echo "Uso: ./subir-servidor.sh root@IP"; exit 1; }
rsync -av \
  --exclude 'sesion/' --exclude 'media/' --exclude 'mensajes.sqlite*' --exclude 'grupos.json' \
  --exclude 'node_modules/' --exclude '.wwebjs_cache/' --exclude '*.log' --exclude 'navio-enviados.json' \
  --exclude '.env' --exclude '*.plist' --exclude '.DS_Store' \
  ./ "$1:/home/vigilante/whats-lector/"
# .env = avisos a Telegram (TELEGRAM_TOKEN/TELEGRAM_CHAT); va aparte por ssh, como la clave
[[ -f .env ]] && scp .env "$1:/home/vigilante/whats-lector/.env"
ssh "$1" 'chown -R vigilante:vigilante /home/vigilante/whats-lector && chmod 600 /home/vigilante/whats-lector/{navio-clave.txt,.env} 2>/dev/null; cd /home/vigilante/whats-lector && sudo -u vigilante PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev'
echo "✅ Copiado. Sigue: vincular (sudo -u vigilante CHROME=/usr/bin/google-chrome node vincular.js) y luego el servicio."
