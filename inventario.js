// inventario.js — lista los grupos SIN usar cliente.getChats().
//
// Por qué no getChats(): mapea todos los chats con getChatModel() dentro de un
// Promise.all, y ahí basta que UN chat reviente para que se caiga la lista
// entera. El 2026-09-07 tiró `r: r` (error minificado del bundle de WhatsApp)
// y se llevó el inventario completo.
//
// Aquí se leen los campos del modelo a pelo, cada chat en su propio try. Un
// chat podrido sale reportado en `problemas` y los demás pasan.

export async function listarGrupos(cliente) {
  return await cliente.pupPage.evaluate(async () => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    const grupos = [], problemas = [];
    let totalChats = 0;

    for (const chat of chats) {
      totalChats++;
      try {
        const id = chat?.id?._serialized ?? null;
        if (!id || !id.endsWith('@g.us')) continue; // solo grupos

        // participantes: la colección cambia de forma entre versiones
        const p = chat?.groupMetadata?.participants;
        const participantes =
          p?.getModelsArray?.().length ??
          p?._models?.length ??
          (Array.isArray(p) ? p.length : null);

        grupos.push({
          id,
          nombre: chat?.formattedTitle ?? chat?.name ?? chat?.contact?.name ?? '(sin nombre)',
          participantes,
          ts: typeof chat?.t === 'number' ? chat.t : null,
        });
      } catch (e) {
        problemas.push({
          id: (() => { try { return chat?.id?._serialized ?? '(sin id)'; } catch { return '(ilegible)'; } })(),
          error: `${e?.name ?? '?'}: ${e?.message ?? String(e)}`,
        });
      }
    }
    return { totalChats, grupos, problemas };
  });
}
