/**
 * OpenAITranslator — traduzione premium via OpenAI gpt-4o-mini
 *
 * Può essere usato da:
 *   A) Il BROADCASTER (guida): traduce in tutte le lingue dei ricevitori, invia via BLE già tradotto
 *   B) Il RECEIVER (turista): traduce il testo ricevuto nella propria lingua (paga lui)
 *
 * Costo indicativo gpt-4o-mini:
 *   ~$0.15 / 1 milione di token in input
 *   Una frase di 20 parole ≈ 25 token → circa $0.000004 per frase
 *   1 ora di tour (≈ 500 frasi) ≈ $0.002 (meno di 1 centesimo)
 *
 * La chiave API viene salvata in localStorage (sicura sul dispositivo personale).
 * Per produzione: usare un backend proxy come in GloboUp (Supabase Edge Function).
 */

const LANG_NAMES: Record<string, string> = {
  it: 'Italian', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese (Simplified)',
  ja: 'Japanese', ar: 'Arabic', hi: 'Hindi', ko: 'Korean',
  nl: 'Dutch', pl: 'Polish', tr: 'Turkish', uk: 'Ukrainian',
};

export type TranslatorRole = 'broadcaster' | 'receiver';

export class OpenAITranslator {
  private apiKey: string;
  private cache = new Map<string, string>();
  private pendingRequests = new Map<string, Promise<string>>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ── Gestione chiave API (localStorage) ────────────────────────────────────

  static getStoredKey(role: TranslatorRole): string {
    return localStorage.getItem(`globoair_openai_key_${role}`) ?? '';
  }

  static saveKey(role: TranslatorRole, key: string): void {
    if (key.trim()) {
      localStorage.setItem(`globoair_openai_key_${role}`, key.trim());
    } else {
      localStorage.removeItem(`globoair_openai_key_${role}`);
    }
  }

  static hasKey(role: TranslatorRole): boolean {
    return OpenAITranslator.getStoredKey(role).startsWith('sk-');
  }

  // ── Traduzione singola lingua ─────────────────────────────────────────────

  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    if (!text.trim() || sourceLang === targetLang) return text;

    const cacheKey = `${sourceLang}|${targetLang}|${text}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    // Deduplicazione: se è già in volo la stessa richiesta, aspetta quella
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    const promise = this._callAPI(text, sourceLang, targetLang);
    this.pendingRequests.set(cacheKey, promise);

    try {
      const result = await promise;
      // Cache LRU (max 200 voci)
      if (this.cache.size >= 200) {
        const first = this.cache.keys().next().value;
        if (first !== undefined) this.cache.delete(first);
      }
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Traduce in parallelo in più lingue — usato dal BROADCASTER
   * per inviare le traduzioni pre-calcolate a tutti i ricevitori.
   *
   * @param text       Testo da tradurre
   * @param sourceLang Lingua della guida (es. 'it')
   * @param targetLangs Lingue dei ricevitori connessi (es. ['en', 'ja', 'fr'])
   * @returns Map: { 'en' → 'Hello everyone', 'ja' → 'みなさん、こんにちは', ... }
   */
  async translateAll(
    text: string,
    sourceLang: string,
    targetLangs: string[]
  ): Promise<Map<string, string>> {
    const uniqueLangs = [...new Set(targetLangs.filter(l => l !== sourceLang))];
    if (uniqueLangs.length === 0) return new Map();

    const results = await Promise.allSettled(
      uniqueLangs.map(lang => this.translate(text, sourceLang, lang))
    );

    const map = new Map<string, string>();
    results.forEach((result, idx) => {
      map.set(
        uniqueLangs[idx],
        result.status === 'fulfilled' ? result.value : text // fallback: originale
      );
    });
    return map;
  }

  // ── Chiamata API OpenAI ───────────────────────────────────────────────────

  private async _callAPI(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const targetName = LANG_NAMES[targetLang] ?? targetLang;
    const sourceName = LANG_NAMES[sourceLang] ?? sourceLang;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              `You are a professional interpreter for a tour guide app. ` +
              `Translate from ${sourceName} to ${targetName}. ` +
              `Rules: (1) Output ONLY the translation, nothing else. ` +
              `(2) Preserve proper nouns, place names, and numbers. ` +
              `(3) Keep the same tone and enthusiasm as the original. ` +
              `(4) If the text is already in ${targetName}, return it unchanged.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
        max_tokens: 500,
        temperature: 0.1, // bassa temperatura = traduzione più fedele
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenAI API ${response.status}: ${errorBody}`);
    }

    const json = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    return json.choices?.[0]?.message?.content?.trim() ?? text;
  }

  destroy(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}
