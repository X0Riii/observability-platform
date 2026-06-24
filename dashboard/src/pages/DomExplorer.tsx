import { useState, useEffect, useRef } from 'react';
import { fetchSession, fetchTimeline } from '../api';

export function DomExplorer() {
  const [sessionId, setSessionId] = useState('');
  const [domEvents, setDomEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = async () => {
    if (!sessionId) return;
    const data = await fetchTimeline(sessionId);
    setDomEvents(data.domEvents || []);
  };

  const renderSnapshot = (event: any) => {
    setSelectedEvent(event);
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">DOM Explorer</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={sessionId}
          onChange={e => setSessionId(e.target.value)}
          placeholder="Session ID"
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-80"
        />
        <button onClick={load} className="px-3 py-1.5 bg-cyan-800 rounded text-sm">Load</button>
      </div>

      {domEvents.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1 max-h-[70vh] overflow-y-auto">
            {domEvents.map((e: any, i: number) => (
              <div key={e.id || i}
                onClick={() => renderSnapshot(e)}
                className={`text-xs font-mono p-2 rounded cursor-pointer ${selectedEvent?.id === e.id ? 'bg-cyan-900/30 border border-cyan-800' : 'bg-gray-900 border border-gray-800 hover:bg-gray-800'}`}>
                <div className="text-gray-400">{new Date(e.ts).toISOString()}</div>
                <div className="text-gray-300 truncate">{e.mutationType || e.type}</div>
                <div className="text-gray-600 truncate">{e.targetPath || ''}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded border border-gray-800 p-4">
            <h3 className="text-sm font-medium mb-2 text-cyan-400">Event Details</h3>
            <pre className="text-xs text-gray-400 overflow-auto max-h-[60vh]">
              {JSON.stringify(selectedEvent || domEvents[0], null, 2)}
            </pre>
          </div>
        </div>
      )}

      {domEvents.length === 0 && sessionId && (
        <div className="text-gray-500 text-sm">No DOM events found.</div>
      )}
    </div>
  );
}
