/**
 * GloboAirRealtimeClient — STT in tempo reale via OpenAI Realtime API
 *
 * Ruolo in GloboAir:
 *   1. Cattura l'audio del broadcaster (guida)
 *   2. Lo invia alla Supabase Edge Function "openai-realtime" (progetto GloboAir)
 *   3. Riceve trascrizioni Whisper-quality in streaming
 *   4. La trascrizione viene poi tradotta da OpenAITranslator.translateAll()
 *      e inviata via BLE a tutti i receiver (ognuno nella propria lingua)
 *
 * Vantaggio rispetto a SpeechCapture (browser STT):
 *   - Qualità Whisper: accenti, ambienti rumorosi, lingue difficili (arabo, hindi)
 *   - Streaming vero: trascrizione parziale già durante il parlato
 *   - Nessun limite di lingua (tutte supportate da Whisper)
 *
 * Prerequisiti:
 *   - Supabase Edge Function "openai-realtime" deployata (vedere supabase/functions/)
 *   - VITE_GLOBOAIR_SUPABASE_URL in .env
 *   - OPENAI_API_KEY impostata come secret Supabase (mai nel client)
 */

/** Callback: testo trascritto + se è finale (fine frase) */
export type OnTranscriptRT = (text: string, isFinal: boolean) => void;

/** Stato della connessione Realtime */
export type RealtimeState = 'idle' | 'connecting' | 'ready' | 'error' | 'disconnected';

export class GloboAirRealtimeClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private onTranscript: OnTranscriptRT;
  private onStateChange?: (state: RealtimeState) => void;

  private sourceLang: string;
  private partialText = '';
  private _state: RealtimeState = 'idle';

  /** URL della Supabase Edge Function GloboAir (da .env) */
  static readonly WS_URL = (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: string = (import.meta as any).env?.VITE_GLOBOAIR_SUPABASE_URL ?? '';
    if (!base) return '';
    // https://xxx.supabase.co → wss://xxx.supabase.co/functions/v1/openai-realtime
    return base.replace(/^https?/, 'wss') + '/functions/v1/openai-realtime';
  })();

  constructor(
    sourceLang: string,
    onTranscript: OnTranscriptRT,
    onStateChange?: (state: RealtimeState) => void
  ) {
    this.sourceLang = sourceLang;
    this.onTranscript = onTranscript;
    this.onStateChange = onStateChange;
  }

  get state(): RealtimeState { return this._state; }

  static isConfigured(): boolean {
    return !!GloboAirRealtimeClient.WS_URL;
  }

  // ── Connessione ───────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (!GloboAirRealtimeClient.WS_URL) {
      throw new Error(
        'VITE_GLOBOAIR_SUPABASE_URL non configurata. ' +
        'Aggiungi la variabile nel file .env del progetto GloboAir.'
      );
    }

    this._setState('connecting');

    // 1. Apri WebSocket verso la Supabase Edge Function
    this.ws = new WebSocket(GloboAirRealtimeClient.WS_URL);

    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve();
      this.ws!.onerror = () => reject(new Error('Impossibile connettersi al server Realtime'));
      setTimeout(() => reject(new Error('Timeout connessione Realtime (10s)')), 10_000);
    });

    // 2. Registra handler messaggi OpenAI
    this.ws.onmessage = (event) => this._handleMessage(event.data as string);
    this.ws.onclose   = () => { this._setState('disconnected'); this._cleanup(); };
    this.ws.onerror   = () => { this._setState('error'); };

    // 3. Configura sessione: STT con Whisper, VAD automatico, solo testo (no audio output)
    this._send({
      type: 'session.update',
      session: {
        modalities: ['text'],          // solo testo — no audio in output (la guida parla già)
        instructions:
          'Trascrivi fedelmente l\'audio in ' + this._langName(this.sourceLang) + '. ' +
          'Non tradurre. Non aggiungere commenti. Output solo la trascrizione.',
        input_audio_format: 'pcm16',   // PCM 16-bit, 24kHz, mono
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: {
          type: 'server_vad',          // OpenAI rileva automaticamente i turni di parola
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,    // 0.7s di silenzio = fine frase
        },
        temperature: 0.0,             // trascrizione deterministica
      },
    });

    // 4. Avvia la cattura audio del microfono
    await this._startAudio();
    this._setState('ready');
  }

  // ── Gestione messaggi OpenAI ─────────────────────────────────────────────

  private _handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const type = msg.type as string;

    switch (type) {
      // Trascrizione parziale (durante il parlato)
      case 'conversation.item.input_audio_transcription.delta': {
        const delta = (msg.delta as string) ?? '';
        this.partialText += delta;
        if (this.partialText.trim()) {
          this.onTranscript(this.partialText.trim(), false /* isFinal */);
        }
        break;
      }

      // Trascrizione completata (fine turno)
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (msg.transcript as string)?.trim() ?? '';
        if (text) {
          this.onTranscript(text, true /* isFinal */);
        }
        this.partialText = '';
        break;
      }

      // OpenAI rileva inizio parola
      case 'input_audio_buffer.speech_started':
        this.partialText = '';
        break;

      // Errore
      case 'error': {
        const errMsg = (msg.error as { message?: string })?.message ?? JSON.stringify(msg.error);
        console.error('[GloboAirRealtime] Errore OpenAI:', errMsg);
        this._setState('error');
        break;
      }
    }
  }

  // ── Cattura audio ─────────────────────────────────────────────────────────

  private async _startAudio(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;

    this.audioContext = new AC({ sampleRate: 24_000 });
    await this.audioContext.resume().catch(() => {});

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 24_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // ScriptProcessor: cattura chunk audio e li invia a OpenAI
    // (in produzione si userebbe AudioWorklet, ma ScriptProcessor è più compatibile)
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const pcm16 = this._float32ToPcm16(e.inputBuffer.getChannelData(0));
      const b64   = this._arrayBufferToBase64(pcm16.buffer);
      this._send({ type: 'input_audio_buffer.append', audio: b64 });
    };

    this.source.connect(this.processor);
    // Connetti a un gain=0 per silenziare il playback locale (no feedback)
    const silence = this.audioContext.createGain();
    silence.gain.value = 0;
    this.processor.connect(silence);
    silence.connect(this.audioContext.destination);
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  disconnect(): void {
    this._cleanup();
    this._setState('disconnected');
  }

  private _cleanup(): void {
    this.source?.disconnect();
    this.processor?.disconnect();
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.audioContext?.close().catch(() => {});
    this.source = null;
    this.processor = null;
    this.mediaStream = null;
    this.audioContext = null;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
    this.partialText = '';
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  private _send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private _setState(s: RealtimeState): void {
    this._state = s;
    this.onStateChange?.(s);
  }

  private _float32ToPcm16(float32: Float32Array): Int16Array {
    const pcm = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32[i]));
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }
    return pcm;
  }

  private _arrayBufferToBase64(buffer: ArrayBufferLike): string {
    const bytes = new Uint8Array(buffer as ArrayBuffer);
    let binary  = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  private _langName(code: string): string {
    const map: Record<string, string> = {
      it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese',
      de: 'tedesco', pt: 'portoghese', ru: 'russo', zh: 'cinese',
      ja: 'giapponese', ar: 'arabo', hi: 'hindi', ko: 'coreano',
      nl: 'olandese', pl: 'polacco', tr: 'turco', uk: 'ucraino',
    };
    return map[code] ?? code;
  }
}
