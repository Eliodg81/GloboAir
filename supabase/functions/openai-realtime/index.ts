/**
 * GloboAir — Supabase Edge Function: openai-realtime
 *
 * Proxy WebSocket tra l'app GloboAir e l'API OpenAI Realtime.
 * La chiave OpenAI è un segreto Supabase (mai esposta al client).
 *
 * Architettura:
 *   App (broadcaster) ──WS──► questa funzione ──WS──► OpenAI Realtime API
 *
 * Deploy:
 *   supabase secrets set OPENAI_API_KEY=sk-...
 *   supabase functions deploy openai-realtime
 *
 * IMPORTANTE: questo progetto Supabase è dedicato a GloboAir.
 *             Non condivide nulla con GloboUp.
 */

// @ts-ignore — Deno runtime
const OPENAI_API_KEY: string = Deno.env.get('OPENAI_API_KEY') ?? '';

const OPENAI_WS_URL =
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

// @ts-ignore — Deno.serve
Deno.serve((req: Request) => {
  // Solo WebSocket
  const upgradeHeader = req.headers.get('upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response(
      JSON.stringify({ error: 'Richiesta WebSocket richiesta' }),
      { status: 426, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY non configurata' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Upgrade connessione con il client (app GloboAir)
  // @ts-ignore
  const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);

  let openaiSocket: WebSocket | null = null;
  let clientReady = false;
  const pendingMessages: string[] = [];

  clientSocket.onopen = () => {
    clientReady = true;

    // Apri connessione verso OpenAI Realtime
    openaiSocket = new WebSocket(OPENAI_WS_URL, [
      'realtime',
      `openai-insecure-api-key.${OPENAI_API_KEY}`,
      'openai-beta.realtime-v1',
    ]);

    openaiSocket.onopen = () => {
      console.log('[GloboAir] Connesso a OpenAI Realtime');

      // Invia i messaggi eventualmente arrivati prima che OpenAI fosse pronto
      for (const msg of pendingMessages) {
        openaiSocket!.send(msg);
      }
      pendingMessages.length = 0;
    };

    openaiSocket.onmessage = (event: MessageEvent) => {
      // Relay: OpenAI → client
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(event.data);
      }
    };

    openaiSocket.onerror = (err: Event) => {
      console.error('[GloboAir] Errore WebSocket OpenAI:', err);
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(JSON.stringify({ type: 'error', error: 'Errore connessione OpenAI' }));
      }
    };

    openaiSocket.onclose = () => {
      console.log('[GloboAir] OpenAI WebSocket chiuso');
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close();
      }
    };
  };

  clientSocket.onmessage = (event: MessageEvent) => {
    // Relay: client → OpenAI
    if (openaiSocket?.readyState === WebSocket.OPEN) {
      openaiSocket.send(event.data);
    } else {
      // Metti in coda se OpenAI non è ancora pronto
      pendingMessages.push(event.data as string);
    }
  };

  clientSocket.onerror = (err: Event) => {
    console.error('[GloboAir] Errore WebSocket client:', err);
    openaiSocket?.close();
  };

  clientSocket.onclose = () => {
    console.log('[GloboAir] Client disconnesso');
    openaiSocket?.close();
    openaiSocket = null;
  };

  return response;
});
