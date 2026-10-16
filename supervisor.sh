#!/bin/zsh
# supervisor.sh — deja escuchar.js corriendo solo, vía launchd.
#   ./supervisor.sh instalar   instala y arranca
#   ./supervisor.sh quitar     lo para y lo desinstala
#   ./supervisor.sh estado     ¿está vivo? + últimas líneas del log
#
# Mientras esté instalado NO corras `node escuchar.js` a mano: dos Chromes con
# el mismo perfil dan «The browser is already running». Primero `quitar`.
set -e
cd "${0:A:h}"
LABEL=mx.maxitravel.whats-lector
DEST=~/Library/LaunchAgents/$LABEL.plist
DOM=gui/$(id -u)

case "$1" in
  instalar)
    sed -e "s#__NODE__#$(command -v node)#" -e "s#__DIR__#$PWD#g" $LABEL.plist > $DEST
    launchctl bootout $DOM/$LABEL 2>/dev/null || true
    # bootout regresa antes de soltar el servicio; bootstrap inmediato da «5: Input/output error»
    for i in {1..20}; do launchctl print $DOM/$LABEL >/dev/null 2>&1 || break; sleep 0.5; done
    launchctl bootstrap $DOM $DEST
    echo "✅ Instalado. Log: $PWD/escuchar.log" ;;
  quitar)
    launchctl bootout $DOM/$LABEL 2>/dev/null || true
    rm -f $DEST
    echo "Parado y desinstalado." ;;
  estado)
    launchctl print $DOM/$LABEL 2>/dev/null | grep -E '^\s*(state|pid|last exit code|runs) ' || echo "No instalado."
    echo "---"; tail -15 escuchar.log 2>/dev/null ;;
  *) echo "Uso: ./supervisor.sh instalar|quitar|estado"; exit 1 ;;
esac
