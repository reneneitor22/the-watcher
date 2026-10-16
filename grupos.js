// grupos.js — arma grupos.json usando la sesión que ya existe. No pide QR.
// Se puede correr solo:  node grupos.js
// vincular.js también lo usa al final.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { listarGrupos } from './inventario.js';

const ARCHIVO = new URL('./grupos.json', import.meta.url).pathname;

export async function escribirInventario(cliente) {
  const { totalChats, grupos, problemas } = await listarGrupos(cliente);

  // respetar las marcas que ya estaban ("escuchar", "navio")
  const previos = existsSync(ARCHIVO)
    ? Object.fromEntries(JSON.parse(readFileSync(ARCHIVO, 'utf8')).map(g => [g.id, g]))
    : {};

  const salida = grupos
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .map(g => ({
      id: g.id,
      nombre: g.nombre,
      participantes: g.participantes,
      ultimo_mensaje: g.ts ? new Date(g.ts * 1000).toISOString() : null,
      escuchar: previos[g.id]?.escuchar ?? false,
      ...(previos[g.id]?.navio && { navio: true }),
    }));

  console.log(`${salida.length} grupos (de ${totalChats} chats):\n`);
  console.log('  últ.msg     pax  grupo');
  console.log('  ' + '─'.repeat(62));
  for (const g of salida) {
    const nom = g.nombre.length > 42 ? g.nombre.slice(0, 41) + '…' : g.nombre;
    console.log(`  ${g.ultimo_mensaje ? g.ultimo_mensaje.slice(0, 10) : '   —      '}  ${String(g.participantes ?? '?').padStart(4)}  ${g.escuchar ? '▶ ' : '  '}${nom}`);
  }

  if (problemas.length) {
    console.log(`\n⚠️  ${problemas.length} chat(s) ilegibles (se saltaron, no estorban):`);
    for (const p of problemas.slice(0, 5)) console.log(`   ${p.id} — ${p.error}`);
  }

  writeFileSync(ARCHIVO, JSON.stringify(salida, null, 2) + '\n');
  console.log('\n📄 Inventario en grupos.json');
  console.log('   Ahora: node marcar.js "Tours MHV"\n');
  return salida;
}

// Ejecutado directo (no importado): abre sesión, lista y cierra.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { arrancar, cerrarLimpio, redDeSeguridad } = await import('./arrancar.js');
  let vivo = null;
  redDeSeguridad(() => vivo);
  console.log('Abriendo la sesión guardada…');
  vivo = await arrancar(cliente => {
    cliente.on('qr', async () => {
      console.error('❌ Pidió QR: la sesión se perdió. Corre: node vincular.js');
      await cerrarLimpio(cliente, 0);
      process.exit(1);
    });
    cliente.on('ready', async () => {
      try { await escribirInventario(cliente); }
      catch (e) { console.error(`\n❌ ${(e?.message ?? e).toString().split('\n')[0]}`); }
      await cerrarLimpio(cliente);
      process.exit(0);
    });
  });
}
