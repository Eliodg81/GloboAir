import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Radio, Square, Users } from 'lucide-react';
import { BLEBroadcaster } from '../ble/BLEBroadcaster';
import { AudioCapture } from '../audio/AudioCapture';
import LanguagePicker from './LanguagePicker';

interface Props { onBack: () => void; }

type BroadcastState = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

export default function BroadcasterView({ onBack }: Props) {
  const [state, setState] = useState<BroadcastState>('idle');
  const [listeners, setListeners] = useState(0);
  const [framesSent, setFramesSent] = useState(0);
  const [error, setError] = useState('');
  const [sourceLang, setSourceLang] = useState('it'); // lingua in cui parla il broadcaster

  const broadcasterRef = useRef<BLEBroadcaster | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);

  const isLive = state === 'live';

  const start = useCallback(async () => {
    setState('starting');
    setError('');
    try {
      const broadcaster = new BLEBroadcaster();
      broadcaster.onConnectedCountChange = (count) => setListeners(count);
      await broadcaster.initialize();
      await broadcaster.startBroadcast();
      broadcasterRef.current = broadcaster;

      let frames = 0;
      const capture = new AudioCapture(async (encoded) => {
        frames++;
        setFramesSent(frames);
        await broadcaster.sendFrame(encoded).catch(console.warn);
      });
      await capture.start();
      captureRef.current = capture;

      setState('live');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto');
      setState('error');
    }
  }, []);

  const stop = useCallback(async () => {
    setState('stopping');
    captureRef.current?.stop();
    await broadcasterRef.current?.stopBroadcast();
    broadcasterRef.current?.destroy();
    captureRef.current = null;
    broadcasterRef.current = null;
    setListeners(0);
    setFramesSent(0);
    setState('idle');
  }, []);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      broadcasterRef.current?.stopBroadcast().catch(() => {});
    };
  }, []);

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

      <div className="flex-1 flex flex-col items-center justify-between px-6 py-4">

        {/* Language selector — visibile solo quando non live */}
        <div className="w-full max-w-xs relative">
          <LanguagePicker
            label="Sto parlando in"
            value={sourceLang}
            onChange={setSourceLang}
            disabled={isLive}
          />
          {isLive && (
            <p className="text-xs text-gray-600 mt-2 text-center">
              Lingua bloccata durante la trasmissione
            </p>
          )}
        </div>

        {/* Mic button */}
        <div className="flex flex-col items-center gap-5">
          <div className="relative flex items-center justify-center">
            {isLive && (
              <>
                <div className="absolute w-52 h-52 rounded-full bg-red-500/10 animate-ping"
                     style={{ animationDuration: '2s' }} />
                <div className="absolute w-44 h-44 rounded-full bg-red-500/15 animate-ping"
                     style={{ animationDuration: '1.5s', animationDelay: '0.3s' }} />
              </>
            )}
            <button
              onClick={isLive ? stop : start}
              disabled={state === 'starting' || state === 'stopping'}
              className={`relative w-36 h-36 rounded-full flex items-center justify-center
                          shadow-2xl active:scale-95 transition-all duration-200 disabled:opacity-50
                          ${isLive
                            ? 'bg-red-500 shadow-red-500/40 hover:bg-red-600'
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
          <div className="text-center min-h-[40px]">
            {state === 'idle'     && <p className="text-gray-400">Premi per trasmettere</p>}
            {state === 'starting' && <p className="text-yellow-400 animate-pulse">Avvio...</p>}
            {state === 'live'     && <p className="text-red-400 font-semibold animate-pulse">🔴 IN ONDA</p>}
            {state === 'stopping' && <p className="text-gray-400 animate-pulse">Interruzione...</p>}
            {state === 'error'    && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        </div>

        {/* Stats */}
        {isLive ? (
          <div className="w-full max-w-xs flex gap-3">
            <StatCard icon={<Users className="w-4 h-4" />} label="In ascolto" value={listeners.toString()} color="text-blue-400" />
            <StatCard icon={<Radio className="w-4 h-4" />}  label="Frame inviati" value={framesSent.toString()} color="text-green-400" />
          </div>
        ) : (
          <p className="text-xs text-gray-600 text-center">
            Raggio ~30m · Nessun internet richiesto
          </p>
        )}
      </div>
    </div>
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
