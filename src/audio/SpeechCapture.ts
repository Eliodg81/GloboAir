/**
 * SpeechCapture — cattura voce e produce testo via Web Speech API (STT)
 *
 * Usa SpeechRecognition (nativo nel browser/WebView) — zero costi, zero latenza.
 * Su iOS: WKWebView supporta SpeechRecognition da iOS 14.5+
 * Su Android: supportato da Chrome WebView
 *
 * Output: callback con testo riconosciuto ogni frase completa
 */

export type OnTranscriptCallback = (text: string, isFinal: boolean) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionAny = any;

export class SpeechCapture {
  private recognition: SpeechRecognitionAny | null = null;
  private onTranscript: OnTranscriptCallback;
  private sourceLang: string;
  public isCapturing = false;

  constructor(sourceLang: string, onTranscript: OnTranscriptCallback) {
    this.sourceLang = sourceLang;
    this.onTranscript = onTranscript;
  }

  async start(): Promise<void> {
    const SpeechRec = (window as any).SpeechRecognition
                   || (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      throw new Error('SpeechRecognition non supportato su questo dispositivo');
    }

    this.recognition = new SpeechRec();
    this.recognition.lang = this._langCode(this.sourceLang);
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        const confidence: number = result[0].confidence ?? 1.0;

        // Ignora risultati troppo corti (rumori, sillabe isolate)
        if (text.length < 3) continue;

        // Ignora risultati finali con confidence troppo bassa (rumori riconosciuti male)
        if (result.isFinal && confidence < 0.4) continue;

        // Ignora risultati finali di una sola parola brevissima (< 4 caratteri)
        if (result.isFinal && text.split(' ').length === 1 && text.length < 4) continue;

        this.onTranscript(text, result.isFinal);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onerror = (event: any) => {
      console.error('[SpeechCapture] error:', event.error);
      if (event.error === 'no-speech') return; // normale, ignora
      if (event.error !== 'aborted') this._restart();
    };

    this.recognition.onend = () => {
      if (this.isCapturing) this._restart(); // riavvia automaticamente
    };

    this.recognition.start();
    this.isCapturing = true;
  }

  stop(): void {
    this.isCapturing = false;
    this.recognition?.abort();
    this.recognition = null;
  }

  updateSourceLang(lang: string): void {
    this.sourceLang = lang;
    if (this.isCapturing) {
      this.stop();
      this.start();
    }
  }

  private _restart(): void {
    if (!this.isCapturing) return;
    setTimeout(() => {
      try { this.recognition?.start(); } catch { /* ignora */ }
    }, 300);
  }

  // Mappa codice lingua (es. 'it') → BCP-47 (es. 'it-IT')
  private _langCode(code: string): string {
    const map: Record<string, string> = {
      it: 'it-IT', en: 'en-US', es: 'es-ES', fr: 'fr-FR',
      de: 'de-DE', pt: 'pt-PT', ru: 'ru-RU', zh: 'zh-CN',
      ja: 'ja-JP', ar: 'ar-SA', hi: 'hi-IN', ko: 'ko-KR',
      nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR', uk: 'uk-UA',
    };
    return map[code] ?? 'it-IT';
  }
}
