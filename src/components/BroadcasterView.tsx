import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Radio, Square, Users } from 'lucide-react';
import { BLEBroadcaster } from '../ble/BLEBroadcaster';
import { AudioCapture } from '../audio/AudioCapture';

interface Props { onBack: () => void; }

type BroadcastState = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

export default function BroadcasterView({ onBack }: Props) {
  const [state, setState] = useState<BroadcastState>('idle');
  const [listeners, setListeners] = useState(0);
  const [framesSent, setFramesSent] = useState(0);
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);

  const broadcasterRef = useRef<BLEBroadcaster | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const start = useCallback(async () => {
    setState('starting');
    setError('');

    try {
      // Init BLE broadcaster
      const broadcaster = new BLEBroadcaster();
      broadcaster.onConnectedCountChange = (count) => setListeners(count);
      await broadcaster.initialize();
      await broadcaster.startBroadcast();
      broadcasterRef.current = broadcaster;

      // Init audio capture
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
      const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
      setError(msg);
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
    setLevel(0);
    setState('idle');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      broadcasterRef.current?.stopBroadcast().catch(() => {});
      if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
    };
  }, []);

  const isLive = state === 'live';

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

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8">

        {/* Big button */}
        <div className="relative flex items-center justify-center">
          {/* Ping rings when live */}
          {isLive && (
            <>
              <div className="absolute w-52 h-52 rounded-full bg-red-500/10 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="absolute w-44 h-44 rounded-full bg-red-500/15 animate-ping" style={{ animationDuration: '1.5s' }} />
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

        {/* Status text */}
        <div className="text-center">
          {state === 'idle' && (
            <p className="text-gray-400 text-base">Premi per iniziare la trasmissione</p>
          )}
          {state === 'starting' && (
            <p className="text-yellow-400 text-base animate-pulse">Avvio in corso...</p>
          )}
          {state === 'live' && (
            <div className="flex flex-col items-center gap-1">
              <p className="text-red-400 text-base font-semibold animate-pulse">
                🔴 IN ONDA
              </p>
              <p className="text-gray-400 text-sm">
                Parla nel microfono
              </p>
            </div>
          )}
          {state === 'stopping' && (
            <p className="text-gray-400 text-base animate-pulse">Interruzione...</p>
          )}
          {state === 'error' && (
            <div className="text-center">
              <p className="text-red-400 text-base">Errore</p>
              <p className="text-gray-500 text-xs mt-1">{error}</p>
            </div>
          )}
        </div>

        {/* Stats — visibili solo quando live */}
        {isLive && (
          <div className="w-full max-w-xs flex gap-3">
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="In ascolto"
              value={listeners.toString()}
              color="text-blue-400"
            />
            <StatCard
              icon={<Radio className="w-4 h-4" />}
              label="Frame inviati"
              value={framesSent.toString()}
              color="text-green-400"
            />
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="px-8 pb-6 text-center">
        <p className="text-xs text-gray-600">
          {isLive
            ? 'I telefoni vicini possono connettersi aprendo GloboAir'
            : 'Raggio ~30m · Nessun internet richiesto'}
        </p>
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
