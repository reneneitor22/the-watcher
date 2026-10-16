// cliente.js — fábrica del cliente de WhatsApp en modo SOLO LECTURA.
//
// Regla dura del proyecto: este proceso jamás envía nada. Ni mensajes, ni
// acuses de lectura, ni estados de "escribiendo". Los métodos de escritura de
// whatsapp-web.js quedan tapiados abajo, así que un descuido futuro truena
// en vez de mandar algo a un grupo de clientes.

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import Chat from 'whatsapp-web.js/src/structures/Chat.js';
import Message from 'whatsapp-web.js/src/structures/Message.js';

// En el servidor Linux: CHROME=/usr/bin/google-chrome (ver whats-lector.service)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// --- Tapia anti-envío -------------------------------------------------------
const PROHIBIDOS = {
  Client: [
    'sendMessage', 'sendSeen', 'sendPresenceAvailable', 'sendPresenceUnavailable',
    'createGroup', 'setStatus', 'setDisplayName', 'archiveChat', 'pinChat',
    'muteChat', 'markChatUnread', 'sendMessageToAdmins',
  ],
  Chat: ['sendMessage', 'sendSeen', 'sendStateTyping', 'sendStateRecording', 'clearMessages', 'delete', 'archive', 'pin', 'mute'],
  Message: ['reply', 'react', 'forward', 'delete', 'star', 'edit'],
};

function tapiar(nombre, proto, metodos) {
  for (const m of metodos) {
    Object.defineProperty(proto, m, {
      configurable: false,
      writable: false,
      value() {
        throw new Error(
          `BLOQUEADO: ${nombre}.${m}() — este lector es de solo lectura. ` +
          `Si de verdad hace falta escribir, quítalo de PROHIBIDOS en cliente.js a propósito, no por accidente.`
        );
      },
    });
  }
}

tapiar('Client', Client.prototype, PROHIBIDOS.Client);
tapiar('Chat', Chat.prototype, PROHIBIDOS.Chat);
tapiar('Message', Message.prototype, PROHIBIDOS.Message);
// ---------------------------------------------------------------------------

export function crearCliente() {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: 'maxi-lector',
      dataPath: new URL('./sesion/', import.meta.url).pathname,
    }),
    puppeteer: {
      headless: true,
      executablePath: CHROME,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  });
}

export { PROHIBIDOS };
