/**
 * SpeechPlayer — riproduce testo ad alta voce via Web Speech API (TTS)
 *
 * Usa SpeechSynthesis (nativo nel browser/WebView) — zero costi, zero latenza.
 * Su iOS:    supportato da Safari WebView (voce offline inclusa)
 * Su Android: supportato da Chrome WebView (voce Google)
 *
 * Funzionalità:
 *   - Coda interna: legge le frasi in ordine senza sovrapporsi
 *   - Auto-seleziona la voce migliore per la lingua target
 *   - Annulla la coda quando la lingua cambia
 */

export class SpeechPlayer {
  private synth: SpeechSynthesis;
  private targetLang: string;
  private queue: string[] = [];
  private isSpeaking = false;

  constructor(targetLang: string) {
    this.synth = window.speechSynthesis;
    this.targetLang = targetLang;

    // Alcune piattaforme caricano le voci in modo asincrono
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => { /* voci pronte */ };
    }
  }

  /** Aggiorna la lingua di output e svuota la coda corrente */
  updateTargetLang(lang: string): void {
    if (this.targetLang === lang) return;
    this.targetLang = lang;
    this.stop();
  }

  /**
   * Aggiunge `text` alla coda di riproduzione.
   * Se nulla è in riproduzione, parte immediatamente.
   */
  speak(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.queue.push(clean);
    this._processQueue();
  }

  private _processQueue(): void {
    if (this.isSpeaking || this.queue.length === 0) return;
    const text = this.queue.shift()!;
    this.isSpeaking = true;

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = this._bcp47(this.targetLang);
    utt.rate = 1.05;   // leggermente più veloce per seguire la guida
    utt.pitch = 1.0;
    utt.volume = 1.0;

    // Seleziona la voce locale migliore per la lingua (preferenza: voce offline)
    const langPrefix = utt.lang.split('-')[0];
    const voices = this.synth.getVoices();
    const voice =
      voices.find(v => v.localService && v.lang === utt.lang) ??
      voices.find(v => v.localService && v.lang.startsWith(langPrefix)) ??
      voices.find(v => v.lang === utt.lang) ??
      voices.find(v => v.lang.startsWith(langPrefix)) ??
      null;
    if (voice) utt.voice = voice;

    utt.onend = () => {
      this.isSpeaking = false;
      this._processQueue();
    };
    utt.onerror = (e) => {
      console.warn('[SpeechPlayer] TTS error:', e.error);
      this.isSpeaking = false;
      this._processQueue();
    };

    this.synth.speak(utt);
  }

  /** Ferma la riproduzione e svuota la coda */
  stop(): void {
    this.synth.cancel();
    this.queue = [];
    this.isSpeaking = false;
  }

  // Mappa codice lingua → BCP-47
  private _bcp47(code: string): string {
    const map: Record<string, string> = {
      it: 'it-IT', en: 'en-US', es: 'es-ES', fr: 'fr-FR',
      de: 'de-DE', pt: 'pt-PT', ru: 'ru-RU', zh: 'zh-CN',
      ja: 'ja-JP', ar: 'ar-SA', hi: 'hi-IN', ko: 'ko-KR',
      nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR', uk: 'uk-UA',
    };
    return map[code] ?? 'en-US';
  }
}
