import { useState } from 'react';
import ModeSelect from './components/ModeSelect';
import BroadcasterView from './components/BroadcasterView';
import ReceiverView from './components/ReceiverView';

export type AppMode = 'select' | 'broadcast' | 'receive';

export default function App() {
  const [mode, setMode] = useState<AppMode>('select');

  return (
    <div className="h-full w-full flex flex-col bg-[#0a0a0a] safe-top safe-bottom overflow-hidden">
      {mode === 'select'    && <ModeSelect onSelect={setMode} />}
      {mode === 'broadcast' && <BroadcasterView onBack={() => setMode('select')} />}
      {mode === 'receive'   && <ReceiverView    onBack={() => setMode('select')} />}
    </div>
  );
}
