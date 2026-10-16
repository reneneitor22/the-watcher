// vincular.js — PASO 1: enlaza el número lector y saca el inventario de grupos.
//
// Orden a propósito: primero se asegura la SESIÓN (pausa para que Chrome
// escriba las llaves a disco), y hasta después se intenta el inventario. Si el
// inventario falla, la sesión ya está a salvo y se reintenta con `node
// grupos.js` — sin volver a escanear el QR.

import qrcode from 'qrcode-terminal';
import { arrancar, cerrarLimpio, redDeSeguridad } from './arrancar.js';
import { escribirInventario } from './grupos.js';

let clienteVivo = null;
redDeSeguridad(() => clienteVivo);

function preparar(cliente) {
  cliente.on('qr', qr => {
    console.log('\n📱 Escanea con el número LECTOR:');
    console.log('   WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo\n');
    qrcode.generate(qr, { small: true });
  });

  cliente.on('auth_failure', async m => {
    console.error('❌ Falló la autenticación:', m);
    await cerrarLimpio(cliente);
    process.exit(1);
  });

  cliente.on('ready', async () => {
    const yo = cliente.info;
    console.log(`\n✅ Vinculado como: ${yo.pushname} (${yo.wid.user})`);

    // La sesión primero. Nada de listas antes de esto.
    console.log('💾 Asentando la sesión en disco…');
    await new Promise(r => setTimeout(r, 5000));
    console.log('   Sesión guardada en ./sesion/\n');

    try {
      await escribirInventario(cliente);
    } catch (e) {
      console.error(`\n⚠️  El inventario falló: ${(e?.message ?? e).toString().split('\n')[0]}`);
      console.error('   PERO la sesión quedó buena. NO vuelvas a escanear.');
      console.error('   Reintenta solo el inventario con:  node grupos.js\n');
    }

    await cerrarLimpio(cliente);
    process.exit(0);
  });
}

console.log('Arrancando Chrome (headless)… tarda unos segundos la primera vez.');

clienteVivo = await arrancar(preparar).catch(err => {
  console.error(`\n❌ No arrancó: ${(err?.message ?? err).toString().split('\n')[0]}`);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\nCancelado. Cerrando bien…');
  await cerrarLimpio(clienteVivo);
  process.exit(0);
});
