import { useState } from 'react';
import { search } from '../api';

export function StorageExplorer() {
  const [cookieData, setCookieData] = useState<any[]>([]);
  const [storageData, setStorageData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadStorageData = async () => {
    setLoading(true);
    const cookieResults = await search('', { type: 'storage:cookies' }, 0, 50);
    setCookieData(cookieResults.hits || []);

    const storageResults = await search('', { type: 'storage:set' }, 0, 50);
    setStorageData(storageResults.hits || []);

    setLoading(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Storage Explorer</h2>
        <button onClick={loadStorageData} className="px-3 py-1.5 bg-cyan-800 rounded text-sm">Load Storage Data</button>
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading...</div>}

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-2">Cookies</h3>
          <div className="space-y-1">
            {cookieData.map((c: any, i: number) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded p-2 text-xs">
                <div className="text-cyan-400">{c._source?.cookieName || c._source?.url || 'Unknown'}</div>
                <div className="text-gray-500 truncate">{c._source?.content?.substring(0, 100)}</div>
              </div>
            ))}
            {cookieData.length === 0 && <div className="text-gray-600 text-xs">No cookie data</div>}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-2">LocalStorage / SessionStorage</h3>
          <div className="space-y-1">
            {storageData.map((s: any, i: number) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded p-2 text-xs">
                <div className="text-yellow-400">{s._source?.storageType || 'Unknown'}</div>
                <div className="text-gray-500 truncate">{s._source?.content?.substring(0, 100)}</div>
              </div>
            ))}
            {storageData.length === 0 && <div className="text-gray-600 text-xs">No storage events</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
