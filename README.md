# whats-lector — WhatsApp de solo lectura → bitácora MaxiTravel

Lee los grupos operativos de WhatsApp y guarda los mensajes crudos. De ahí sale
la bitácora / hoja de operaciones. **Nunca envía nada.**

## Reglas del proyecto

1. **Cero envíos.** `cliente.js` tapia los métodos de escritura de
   whatsapp-web.js (`sendMessage`, `reply`, `react`, `sendSeen`…). Si algo
   intenta escribir, truena.
2. **Crudo primero.** Se guarda el mensaje tal cual llegó. El parser cambia mil
   veces; el mensaje original no se vuelve a bajar.
3. **Un número desechable.** Este número es solo para leer. Si lo tumban, no se
   lleva nada más.
4. **Sesión persistente.** `./sesion/` no se borra. Re-escanear QR seguido es
   señal fea para WhatsApp.

## Riesgo

Usa un cliente no oficial (viola los ToS de WhatsApp, como cualquier cliente no
oficial). La Cloud API oficial **no soporta grupos**, así que no hay ruta
legítima para esto. Leer es el perfil de menor riesgo: los baneos salen casi
siempre de señales de salida (volumen enviado, reportes de quien recibe). Aun
así el riesgo no es cero, y perder el número significa perder la membresía en
los grupos.

## Uso

```bash
node vincular.js    # paso 1: enlaza el número y saca el inventario de grupos
```

Escanea el QR desde el número lector:
WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo.

Deja `grupos.json` con la lista. Marca `"escuchar": true` en los grupos que sí
se van a leer (empieza con **uno**) y sigue con el paso 2.

Correr `vincular.js` otra vez refresca la lista y respeta las marcas que ya
pusiste.

```bash
node marcar.js "Tours MHV"        # marca el grupo (exige coincidencia única)
node marcar.js --quitar "Tours MHV"
node escuchar.js --historial 50   # paso 2: baja los últimos 50 y sigue en vivo
node ver.js 40                    # mirilla: qué se ha guardado
node prueba-filtro.js             # comprueba que no se cuela nada ajeno
```

## Archivos

| archivo | qué hace |
|---|---|
| `cliente.js` | cliente de WhatsApp + tapia anti-envío |
| `arrancar.js` | arranque tolerante a la carrera de whatsapp-web.js |
| `db.js` | SQLite crudo; fechas en UTC-6 fijo (México) |
| `llave.js` | saca la llave única del mensaje en cualquier bundle |
| `procesar.js` | lista blanca + normalización de un mensaje |
| `inventario.js` | lista los grupos leyendo el store a pelo |
| `historial.js` | baja mensajes viejos sin pasar por `getChatModel` |
| `vincular.js` | paso 1: QR e inventario |
| `grupos.js` | reintenta solo el inventario, sin re-escanear |
| `marcar.js` | marca qué grupos escuchar |
| `escuchar.js` | paso 2: escucha y guarda |
| `ver.js` | consulta lo guardado |
| `media.js` | baja adjuntos de grupos Navío sin `getChatModel` |
| `navio.js` | grupo de expediente → sesión de Navío Contratos (`--ver` sin gastar) |
| `prueba-media.js` | baja de verdad los últimos adjuntos y checa peso + firma (supervisor parado) |
| `prueba-llave.js` | prueba de la llave del mensaje |
| `prueba-filtro.js` | prueba del filtro de privacidad |
| `prueba-reintento.js` | prueba del arranque tolerante |
| `prueba-cierre.js` | prueba del cierre ordenado |

## Qué NO hace todavía

- Solo baja adjuntos de grupos con `"navio": true` (`node marcar.js --navio "…"`), a
  `media/<grupo>/`. Los demás solo marcan `tiene_media`.
- `node navio.js "<grupo>"` junta texto + adjuntos del grupo y abre una sesión en
  Navío Contratos (local :3591 o `BASE=`); la liga `?sesion=` corre el análisis.
- No parsea nada: no hay extracción de servicio/unidad/pax. Eso viene después,
  leyendo de `mensajes.sqlite`, no de WhatsApp. Falta juntar mensajes reales:
  hoy la base solo trae el aviso de entrada al grupo.
- No se reinicia solo si se cae. Sale con código 1; el supervisor va después.


## `getChatModel()` es veneno (2026-09-08)

Cualquier API de whatsapp-web.js que pase por
`window.WWebJS.getChatModel` (`src/util/Injected/Utils.js:938`) truena con este
bundle: `getChats()`, `getChatById()` y `Chat.fetchMessages()`.

El error llega a Node minificado a una letra —`r: r`— porque viaja por
`pupPage.evaluate`. Debajo es:

```
DataError: Failed to execute 'get' on 'IDBObjectStore':
           No key or key range specified.
```

Sale del bloque `lastMessage` (`Utils.js:982`), que hace
`Msg.getMessagesById([chat.lastReceivedKey._serialized])`. **En el bundle de
2026-09 las MsgKey ya no traen `_serialized`**, así que la llave va `undefined`
y IndexedDB revienta. Los Wid sí lo conservan; solo las MsgKey lo perdieron.

Se comprobó paso por paso: los 12 pasos sueltos de `getChatModel` pasan
(`serialize`, `WAWebWidFactory`, `groupMetadata.update`, `LidMigrationUtils`),
solo la función completa falla.

**La regla:** nada que pase por `getChatModel`. Leer el store a pelo con
`pupPage.evaluate` (`inventario.js`, `historial.js`). **No parchar
`node_modules`**: un `npm i` se lo lleva.

La llave serializada ahora vive en un campo `$1`. **No se lee `$1`**: ese
nombre lo pone el minificador y cambia en cuanto Meta recompila. `llave.js` la
arma con los campos nombrados (`fromMe`, `remote`, `id`, `participant`).

## Dos trampas de SQLite y del filtrado

1. **`TEXT PRIMARY KEY` acepta NULLs repetidos.** Con `msg.id._serialized`
   viniendo `undefined`, cada mensaje entraba con id NULL y el
   `INSERT OR IGNORE` dejaba de deduplicar **sin un solo error**. Por eso `id`
   lleva `NOT NULL` y `procesar.js` devuelve `sin-llave` en vez de guardar.

2. **El filtro de avisos de la librería no filtra.** `Chat.js:207` usa
   `m.isNotification`, que **no existe en el modelo crudo** del store: siempre
   da `undefined`, así que `!m.isNotification` es siempre `true`. Aquí no se
   filtra nada a propósito (regla #2, crudo primero) y el parser salta los
   avisos por la columna `tipo` (ver `TIPOS_AVISO` en `historial.js`).

## WhatsApp no da historial anterior a tu entrada

Si el número entra hoy a un grupo de hace un año, `loadEarlierMsgs` devuelve
0 y no hay nada que hacer: el servidor no le da lo de antes. La bitácora de un
grupo empieza el día que el número lector entra. Comprobado en TOURS MHV el
2026-09-08 (`gp2/add` del 2026-09-07 23:13, grupo creado en 2025-06-09).

## El `ProtocolError` del arranque

`Client.inject()` de whatsapp-web.js hace dos `pupPage.evaluate()` seguidos
(`Client.js:144` y `:146`) sin proteger la ventana entre ambos. Si WhatsApp Web
se recarga justo ahí, Chrome destruye el contexto y sale:

```
ProtocolError: Protocol error (Runtime.callFunctionOn): Execution context was destroyed.
    at Client.inject (.../whatsapp-web.js/src/Client.js:146:55)
```

La librería no lo atrapa, así que mataba el proceso.

Se investigó (2026-09-07). Descartado con evidencia:

- **Caché fría** — 6 corridas borrando `.wwebjs_cache` y `sesion/`: 6 de 6 bien.
- **Dos Chrome sobre el mismo perfil** — da otro error, claro y distinto:
  `Error: The browser is already running for .../sesion/session-maxi-lector`.

11 corridas aquí sin reproducirlo, contra una falla al primer intento en la
máquina de René. Es una carrera transitoria de la librería, no configuración.
`arrancar.js` reintenta hasta 4 veces con navegador nuevo y espera creciente,
y **no** reintenta errores que no son transitorios (credenciales, etc.), porque
reintentar eso solo escondería el problema.

## WhatsApp Web 2.3000.1049085797: conectado y sordo (2026-10-02)

Con esa versión el cliente queda `CONNECTED` pero **nunca emite `'ready'`**: el
log se queda en «Arrancando Chrome…» y no guarda nada. `'change:hasSynced'`
llega antes de que la página termine de cargar y, dentro de
`onAppStateHasSyncedEvent` (`Client.js` ~297-377), algún paso truena dentro de
la función expuesta; la página se traga el error. 15 s después los mismos pasos
(`LoadUtils` + `attachEventListeners`) funcionan a mano. Fijar `webVersion` con
`webVersionCache` local **no** sirvió (se quitó).

**El rescate** (`preparar` en `escuchar.js`): si 30 s después de
`'authenticated'` no hubo `'ready'`, carga `LoadUtils` si falta `window.WWebJS`,
llama `cliente.attachEventListeners()` y emite `'ready'`. El handler de `ready`
tiene la guarda `listo` para no bajar el historial dos veces. En el log sale:

```
⚠️  WhatsApp no dio «ready» a los 30 s. Conecto los eventos a mano.
```

Detalles que importan:

- **`once('authenticated')`, no `on`.** `inject()` corre otra vez en cada
  `framenavigated` y cada vez registra otro listener de `hasSynced` (se ven 4
  en cada arranque), así que `'authenticated'` sale 4 veces. Con `on` eran 4
  timers que pasaban la guarda `listo` a la par y ataban el store 4 veces.
- **No duplica listeners.** `LoadUtils` no puede quedar a medias
  (`injectToFunction` se traga sus errores), y después de `Msg.on('add')` no hay
  nada que pueda tronar: si el intento original alcanzó a atar `add`, también
  emitió `ready` y el rescate no corre. Verificado por CDP tras un rescate real:
  1 handler de la librería en `Msg 'add'`.
- **WhatsApp alterna versiones entre arranques.** El mismo 2-oct, en minutos:
  1049085797 → 1049092666 (aquí `ready` llega solo) → 1049085797 otra vez (aquí
  entra el rescate). Que un arranque salga bien no prueba que ya se arregló.

Para mirar la página viva sin parar el supervisor: `puppeteer.connect` al puerto
de `sesion/session-maxi-lector/DevToolsActivePort`, `page.evaluate` de solo
lectura y `browser.disconnect()` — **nunca** `browser.close()`.
