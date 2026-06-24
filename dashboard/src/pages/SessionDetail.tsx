import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSession, fetchTimeline, fetchScreenshots } from '../api';
import { TimelineCanvas } from '../components/TimelineCanvas';

export function SessionDetail() {
  const { id } = useParams();
  const [session, setSession] = useState<any>(null);
  const [timeline, setTimeline] = useState<any>(null);
  const [screenshots, setScreenshots] = useState<any[]>([]);
  const [tab, setTab] = useState<'timeline' | 'screenshots'>('timeline');

  useEffect(() => {
    if (!id) return;
    fetchSession(id).then(data => setSession(data));
    fetchTimeline(id).then(data => setTimeline(data));
  }, [id]);

  useEffect(() => {
    if (!session?.pages?.length) return;
    fetchScreenshots(session.pages[0].id).then(data => setScreenshots(data.screenshots || []));
  }, [session]);

  if (!session) return <div className="text-gray-500">Loading...</div>;

  const allEvents = [
    ...(timeline?.requests || []).map((r: any) => ({ ...r, type: 'network', ts: new Date(r.ts).getTime() })),
    ...(timeline?.domEvents || []).map((d: any) => ({ ...d, type: 'dom', ts: new Date(d.ts).getTime() })),
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Session</h2>
        <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-500">ID:</span> <span className="font-mono text-cyan-400">{session.session?.id}</span></div>
          <div><span className="text-gray-500">URL:</span> {session.session?.url_seed}</div>
          <div><span className="text-gray-500">Started:</span> {session.session?.started_at && new Date(session.session.started_at).toLocaleString()}</div>
          <div><span className="text-gray-500">Pages:</span> {session.pages?.length || 0}</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {['timeline', 'screenshots'].map(t => (
          <button key={t} onClick={() => setTab(t as any)}
            className={`px-3 py-1.5 rounded text-sm ${tab === t ? 'bg-cyan-800 text-white' : 'bg-gray-800 text-gray-400'}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <TimelineCanvas events={allEvents} />
      )}

      {tab === 'screenshots' && (
        <div className="grid grid-cols-3 gap-4">
          {screenshots.map((s: any) => (
            <div key={s.id} className="bg-gray-900 rounded border border-gray-800 p-2">
              <img src={`/api/pages/${session?.pages?.[0]?.id}/screenshot/${s.id}`} alt="" className="w-full rounded" />
              <div className="mt-1 text-xs text-gray-500">{s.trigger} — {new Date(s.ts).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
