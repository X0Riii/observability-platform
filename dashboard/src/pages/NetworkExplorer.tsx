import { useState, useEffect } from 'react';
import { fetchSession, fetchTimeline } from '../api';

export function NetworkExplorer() {
  const [sessionId, setSessionId] = useState('');
  const [requests, setRequests] = useState<any[]>([]);
  const [filter, setFilter] = useState('');

  const load = async () => {
    if (!sessionId) return;
    const data = await fetchTimeline(sessionId);
    setRequests(data.requests || []);
  };

  const filtered = requests.filter(r =>
    !filter || r.url?.toLowerCase().includes(filter.toLowerCase())
  );

  const maxTime = Math.max(...filtered.map(r => r.ts ? new Date(r.ts).getTime() : 0), 1);
  const minTime = Math.min(...filtered.map(r => r.ts ? new Date(r.ts).getTime() : 0), 0);
  const range = maxTime - minTime || 1;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Network Explorer</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={sessionId}
          onChange={e => setSessionId(e.target.value)}
          placeholder="Session ID"
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-80"
        />
        <button onClick={load} className="px-3 py-1.5 bg-cyan-800 rounded text-sm">Load</button>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter URL..."
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm flex-1"
        />
      </div>

      <div className="space-y-0.5">
        {filtered.slice(0, 200).map((r: any) => {
          const start = r.ts ? new Date(r.ts).getTime() : 0;
          const x = ((start - minTime) / range) * 100;
          return (
            <div key={r.id} className="flex items-center gap-2 text-xs font-mono bg-gray-900 px-2 py-1 rounded hover:bg-gray-800">
              <span className={`w-16 text-right ${(r.status || 200) >= 400 ? 'text-red-400' : 'text-green-400'}`}>{r.status || '...'}</span>
              <span className="w-8 text-gray-500">{r.method || 'GET'}</span>
              <div className="flex-1 truncate text-gray-300">{r.url || '...'}</div>
              <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-600 rounded-full" style={{ width: `${x}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && sessionId && <div className="text-gray-500 text-sm mt-4">No requests found.</div>}
    </div>
  );
}
