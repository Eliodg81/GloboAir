import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Radio, Square, Users, Mic, Sparkles, Eye, EyeOff, Zap } from 'lucide-react';
import { BLEBroadcaster } from '../ble/BLEBroadcaster';
import { SpeechCapture } from '../audio/SpeechCapture';
import { AudioStreamCapture } from '../audio/AudioStreamCapture';
import { OpenAITranslator } from '../audio/OpenAITranslator';
import { GloboAirRealtimeClient } from '../audio/GloboAirRealtimeClient';
import LanguagePicker from './LanguagePicker';

interface Props { onBack: () => void; }

type BroadcastState = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

/**
 * Quattro modalità di trasmissione:
 *   'voice'    — audio PCM diretto (qualità telefonica, no traduzione)
 *   'base'     — SpeechRecognition nativo + MyMemory (gratis per tutti)
 *   'openai'   — SpeechRecognition nativo + gpt-4o-mini (broadcaster paga, ~$0.002/ora)
 *   'realtime' — OpenAI Realtime Whisper STT + gpt-4o-mini (qualità massima, ~$0.06/ora)
 */
type TransmitMode = 'voice' | 'base' | 'openai' | 'realtime';

export default function BroadcasterView({ onBack }: Props) {
  const [state, setState] = useState<BroadcastState>('idle');
  const [listeners, setListeners] = useState(0);
  const [framesSent, setFramesSent] = useState(0);
  const [error, setError] = useState('');
  const [sourceLang, setSourceLang] = useState('it');
  const [liveText, setLiveText] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState('');

  // Modalità
  const [mode, setMode] = useState<TransmitMode>('base');
  const [apiKey, setApiKey] = useState(OpenAITranslator.getStoredKey('broadcaster'));
  const [showKey, setShowKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);

  const broadcasterRef  = useRef<BLEBroadcaster | null>(null);
  const captureRef      = useRef<SpeechCapture | null>(null);
  const audioCapRef     = useRef<AudioStreamCapture | null>(null);
  const realtimeRef     = useRef<GloboAirRealtimeClient | null>(null);
  const translatorRef   = useRef<OpenAITranslator | null>(null);
  const sentRef         = useRef(0);

  const isLive    = state === 'live';
  const hasApiKey = apiKey.startsWith('sk-');
  const realtimeConfigured = GloboAirRealtimeClient.isConfigured();

  const saveApiKey = (key: string) => {
    setApiKey(key);
    OpenAITranslator.saveKey('broadcaster', key);
  };

  // ── Callback condiviso: testo trascritto → BLE ───────────────────────────
  const handleTranscript = useCallback(async (
    text: string,
    isFinal: boolean,
    broadcaster: BLEBroadcaster
  ) => {
    setLiveText(text);
    // Invia via BLE solo risultati finali con almeno 2 parole o 8 caratteri
    if (!isFinal) return;
    if (text.length < 8 || text.split(' ').length < 2) return;

    try {
      const useTranslation = mode === 'openai' || mode === 'realtime';

      if (useTranslation && translatorRef.current && isFinal) {
        // Broadcaster paga: traduce in ~10 lingue → ogni receiver riceve già tradotto
        const targets = ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'pt', 'ru', 'ko', 'hi', 'nl']
          .filter(l => l !== sourceLang);
        const translations = await translatorRef.current.translateAll(text, sourceLang, targets);
        translations.set(sourceLang, text); // includi anche lingua originale
        await broadcaster.sendTranslatedTexts(translations, isFinal);
      } else {
        // Modalità base: invia testo originale → ogni receiver traduce da solo (gratis)
        await broadcaster.sendText(text, isFinal);
      }

      sentRef.current++;
      setFramesSent(sentRef.current);
    } catch (e) {
      console.warn('[BroadcasterView] send error:', e);
    }

    if (isFinal) setTimeout(() => setLiveText(''), 1800);
  }, [mode, sourceLang]);

  // ── Avvio trasmissione ───────────────────────────────────────────────────
  const start = useCallback(async () => {
    setState('starting');
    setError('');
    sentRef.current = 0;
    console.log('[BroadcasterView] start() chiamato, mode =', mode);

    // Crea translator se necessario
    if ((mode === 'openai' || mode === 'realtime') && hasApiKey) {
      translatorRef.current = new OpenAITranslator(apiKey);
    }

    try {
      console.log('[BroadcasterView] creazione BLEBroadcaster...');
      const broadcaster = new BLEBroadcaster();
      broadcaster.onConnectedCountChange = (count) => setListeners(count);
      console.log('[BroadcasterView] initialize()...');
      await broadcaster.initialize();
      console.log('[BroadcasterView] startBroadcast()...');
      await broadcaster.startBroadcast();
      console.log('[BroadcasterView] advertising avviato!');
      broadcasterRef.current = broadcaster;

      if (mode === 'voice') {
        // ── MODALITÀ VOCE: audio PCM diretto via BLE ─────────────────────
        const audioCap = new AudioStreamCapture();
        await audioCap.start(async (pcm8) => {
          try {
            await broadcaster.sendFrame(pcm8);
            sentRef.current++;
            setFramesSent(sentRef.current);
          } catch { /* ignora errori singoli */ }
        });
        audioCapRef.current = audioCap;
      } else if (mode === 'realtime') {
        // ── MODALITÀ REALTIME: Whisper STT via WebSocket ─────────────────
        setRealtimeStatus('Connessione al server Realtime...');
        const rt = new GloboAirRealtimeClient(
          sourceLang,
          (text, isFinal) => handleTranscript(text, isFinal, broadcaster),
          (s) => {
            setRealtimeStatus(
              s === 'ready'        ? 'Whisper attivo' :
              s === 'connecting'   ? 'Connessione...' :
              s === 'error'        ? 'Errore Realtime' :
              s === 'disconnected' ? 'Disconnesso'    : ''
            );
          }
        );
        await rt.connect();
        realtimeRef.current = rt;
      } else {
        // ── MODALITÀ BASE / OPENAI: SpeechRecognition nativo ─────────────
        const capture = new SpeechCapture(
          sourceLang,
          (text, isFinal) => handleTranscript(text, isFinal, broadcaster)
        );
        await capture.start();
        captureRef.current = capture;
      }

      setState('live');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[BroadcasterView] ERRORE:', msg);
      setError(msg);
      setState('error');
    }
  }, [mode, sourceLang, hasApiKey, apiKey, handleTranscript]);

  // ── Stop trasmissione ────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    setState('stopping');
    captureRef.current?.stop();
    audioCapRef.current?.stop();
    realtimeRef.current?.disconnect();
    translatorRef.current?.destroy();
    await broadcasterRef.current?.stopBroadcast();
    broadcasterRef.current?.destroy();
    captureRef.current = null;
    audioCapRef.current = null;
    realtimeRef.current = null;
    translatorRef.current = null;
    broadcasterRef.current = null;
    setListeners(0);
    setFramesSent(0);
    setLiveText('');
    setRealtimeStatus('');
    setState('idle');
  }, []);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      audioCapRef.current?.stop();
      realtimeRef.current?.disconnect();
      translatorRef.current?.destroy();
      broadcasterRef.current?.stopBroadcast().catch(() => {});
    };
  }, []);

  // ── Badge modalità ───────────────────────────────────────────────────────
  const modeBadge = {
    voice:    { label: 'Voce diretta · No traduzione', color: 'text-green-400' },
    base:     { label: 'Base · Gratis',                color: 'text-gray-400' },
    openai:   { label: 'AI · gpt-4o-mini',             color: 'text-purple-400' },
    realtime: { label: 'Realtime · Whisper',           color: 'text-amber-400' },
  }[mode];

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center px-4 pt-4 pb-2">
        <button onClick={onBack} disabled={isLive}
          className="p-2 rounded-full text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="ml-3 text-base font-semibold text-white">Modalità Broadcast</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-between px-6 py-4 gap-4 overflow-y-auto">

        {/* Language selector */}
        <div className="w-full max-w-xs relative">
          <LanguagePicker
            label="Sto parlando in"
            value={sourceLang}
            onChange={setSourceLang}
            disabled={isLive}
          />
        </div>

        {/* ── Selezione modalità (solo quando non live) ── */}
        {!isLive && (
          <div className="w-full max-w-xs flex flex-col gap-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">
              Modalità traduzione
            </p>

            {/* VOCE DIRETTA */}
            <ModeCard
              active={mode === 'voice'}
              onClick={() => setMode('voice')}
              icon={<Radio className="w-5 h-5" />}
              title="Voce diretta"
              subtitle="Audio in tempo reale · Come una telefonata · Nessuna traduzione"
              badge="Gratis"
              badgeColor="text-green-400"
              iconColor="text-green-400"
            />

            {/* BASE */}
            <ModeCard
              active={mode === 'base'}
              onClick={() => setMode('base')}
              icon={<Mic className="w-5 h-5" />}
              title="Base"
              subtitle="STT nativo del telefono · Ogni turista traduce da solo"
              badge="Gratis"
              badgeColor="text-gray-400"
              iconColor="text-gray-400"
            />

            {/* OPENAI */}
            <ModeCard
              active={mode === 'openai'}
              onClick={() => { setMode('openai'); if (!hasApiKey) setShowKeyInput(true); }}
              icon={<Sparkles className="w-5 h-5" />}
              title="AI Translation"
              subtitle="STT nativo · gpt-4o-mini traduce per tutti i turisti"
              badge="~$0.002/ora"
              badgeColor="text-purple-400"
              iconColor="text-purple-400"
            />

            {/* REALTIME */}
            <ModeCard
              active={mode === 'realtime'}
              onClick={() => { setMode('realtime'); if (!hasApiKey) setShowKeyInput(true); }}
              icon={<Zap className="w-5 h-5" />}
              title="Realtime Whisper"
              subtitle={
                realtimeConfigured
                  ? 'OpenAI Whisper STT + traduzione multi-lingua · Qualità massima'
                  : 'Richiede VITE_GLOBOAIR_SUPABASE_URL in .env'
              }
              badge="~$0.06/ora"
              badgeColor="text-amber-400"
              iconColor="text-amber-400"
              disabled={!realtimeConfigured}
            />

            {/* API Key input (per modalità openai e realtime) */}
            {(mode === 'openai' || mode === 'realtime') && (
              <div className="mt-1">
                <button
                  onClick={() => setShowKeyInput(v => !v)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors mb-2"
                >
                  {showKeyInput ? '▲ Nascondi chiave API' : '▼ Chiave API OpenAI'}
                </button>

                {showKeyInput && (
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => saveApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5
                                 text-white text-sm font-mono placeholder-gray-600
                                 focus:outline-none focus:border-purple-500/50 pr-10"
                    />
                    <button
                      onClick={() => setShowKey(v => !v)}
                      className="absolute right-2.5 top-2.5 text-gray-600 hover:text-gray-400"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                )}

                {!hasApiKey && (
                  <p className="text-xs text-yellow-500/80 mt-1.5">
                    ⚠ Inserisci la chiave OpenAI per attivare questa modalità
                  </p>
                )}
                {hasApiKey && (
                  <p className="text-xs text-green-500/70 mt-1.5">
                    ✓ Chiave API configurata
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Mic button + live text */}
        <div className="flex flex-col items-center gap-5 w-full max-w-xs">
          <div className="relative flex items-center justify-center">
            {isLive && (
              <>
                <div className={`absolute w-52 h-52 rounded-full animate-ping opacity-20
                                ${mode === 'realtime' ? 'bg-amber-500' : mode === 'openai' ? 'bg-purple-500' : 'bg-red-500'}`}
                     style={{ animationDuration: '2s' }} />
                <div className={`absolute w-44 h-44 rounded-full animate-ping opacity-15
                                ${mode === 'realtime' ? 'bg-amber-500' : mode === 'openai' ? 'bg-purple-500' : 'bg-red-500'}`}
                     style={{ animationDuration: '1.5s', animationDelay: '0.3s' }} />
              </>
            )}
            <button
              onClick={isLive ? stop : start}
              disabled={
                state === 'starting' || state === 'stopping' ||
                ((mode === 'openai' || mode === 'realtime') && !hasApiKey)
              }
              className={`relative w-36 h-36 rounded-full flex items-center justify-center
                          shadow-2xl active:scale-95 transition-all duration-200 disabled:opacity-50
                          ${isLive
                            ? mode === 'realtime' ? 'bg-amber-500 shadow-amber-500/40'
                              : mode === 'openai'  ? 'bg-purple-500 shadow-purple-500/40'
                              : 'bg-red-500 shadow-red-500/40'
                            : 'bg-green-500 shadow-green-500/40 hover:bg-green-400'
                          }`}
            >
              {isLive
                ? <Square className="w-12 h-12 text-white fill-white" />
                : <Radio className="w-12 h-12 text-white" />
              }
            </button>
          </div>

          {/* Status */}
          <div className="text-center min-h-[44px]">
            {state === 'idle' && (
              <div>
                <p className="text-gray-400">Premi per trasmettere</p>
                <p className={`text-xs mt-1 ${modeBadge.color}`}>{modeBadge.label}</p>
              </div>
            )}
            {state === 'starting'  && <p className="text-yellow-400 animate-pulse">Avvio...</p>}
            {state === 'live' && (
              <div className="flex flex-col items-center gap-1">
                <p className={`font-semibold animate-pulse
                              ${mode === 'realtime' ? 'text-amber-400' : mode === 'openai' ? 'text-purple-400' : 'text-red-400'}`}>
                  🔴 IN ONDA
                </p>
                <p className={`text-xs ${modeBadge.color}`}>
                  {mode === 'realtime' ? realtimeStatus || 'Realtime Whisper' : modeBadge.label}
                </p>
              </div>
            )}
            {state === 'stopping' && <p className="text-gray-400 animate-pulse">Interruzione...</p>}
            {state === 'error'    && (
              <div className="bg-red-500/10 border border-red-500/40 rounded-2xl px-4 py-3 w-full">
                <p className="text-red-400 text-xs font-bold uppercase mb-1">Errore</p>
                <p className="text-red-300 text-sm leading-relaxed">{error}</p>
                <button onClick={() => setState('idle')}
                  className="mt-2 text-xs text-red-400 underline">Riprova</button>
              </div>
            )}
          </div>

          {/* Live transcription box */}
          {isLive && (
            <div className="w-full min-h-[60px] bg-[#111] border border-[#2a2a2a] rounded-2xl px-4 py-3
                            flex items-start gap-2">
              <Mic className={`w-4 h-4 mt-0.5 shrink-0 animate-pulse
                              ${mode === 'realtime' ? 'text-amber-400' : 'text-red-400'}`} />
              <p className="text-gray-300 text-sm leading-relaxed">
                {liveText || <span className="text-gray-600 italic">In ascolto...</span>}
              </p>
            </div>
          )}
        </div>

        {/* Stats */}
        {isLive ? (
          <div className="w-full max-w-xs flex gap-3">
            <StatCard icon={<Users className="w-4 h-4" />}
                      label="In ascolto" value={listeners.toString()} color="text-blue-400" />
            <StatCard icon={<Radio className="w-4 h-4" />}
                      label="Frasi inviate" value={framesSent.toString()} color="text-green-400" />
          </div>
        ) : (
          <p className="text-xs text-gray-600 text-center">Raggio ~30m</p>
        )}
      </div>
    </div>
  );
}

// ── Componenti interni ──────────────────────────────────────────────────────

function ModeCard({
  active, onClick, icon, title, subtitle, badge, badgeColor, iconColor, disabled
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode;
  title: string; subtitle: string; badge: string;
  badgeColor: string; iconColor: string; disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-2xl border text-left
                  transition-all disabled:opacity-40
                  ${active
                    ? 'bg-white/5 border-white/20'
                    : 'bg-[#1a1a1a] border-[#2a2a2a] hover:border-white/10'}`}
    >
      {/* Radio button */}
      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center
                      ${active ? 'border-white' : 'border-gray-600'}`}>
        {active && <div className="w-2 h-2 rounded-full bg-white" />}
      </div>

      {/* Icon */}
      <span className={`mt-0.5 shrink-0 ${iconColor}`}>{icon}</span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-white text-sm font-semibold">{title}</p>
          <span className={`text-[10px] font-medium shrink-0 ${badgeColor}`}>{badge}</span>
        </div>
        <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
    </button>
  );
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) {
  return (
    <div className="flex-1 bg-[#1a1a1a] rounded-2xl p-4 flex flex-col gap-1">
      <div className={`flex items-center gap-1.5 ${color}`}>
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-2xl font-bold text-white">{value}</span>
    </div>
  );
}
