import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSessions } from '../api';

interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  url_seed: string | null;
  user_agent: string | null;
}

export function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [urlFilter, setUrlFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchSessions(urlFilter || undefined).then(data => {
      setSessions(data.sessions);
      setTotal(data.total);
      setLoading(false);
    });
  }, [urlFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Sessions</h2>
        <input
          type="text"
          placeholder="Filter by URL..."
          value={urlFilter}
          onChange={e => setUrlFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-cyan-700"
        />
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="text-gray-500 text-sm">No sessions found.</div>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <Link key={s.id} to={`/session/${s.id}`}
              className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-cyan-800 transition">
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm text-cyan-400">{s.id.slice(0, 8)}...</div>
                <div className="text-xs text-gray-500">{new Date(s.started_at).toLocaleString()}</div>
              </div>
              <div className="mt-1 text-sm">{s.url_seed || 'N/A'}</div>
              <div className="mt-0.5 text-xs text-gray-600 truncate">{s.user_agent}</div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-600">Total: {total} sessions</div>
    </div>
  );
}
