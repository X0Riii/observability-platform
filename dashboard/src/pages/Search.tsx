import { useState } from 'react';
import { search } from '../api';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [aggregations, setAggregations] = useState<any>({});

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await search(query);
    setResults(data.hits || []);
    setTotal(data.total || 0);
    setAggregations(data.aggregations || {});
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Full-Text Search</h2>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search URLs, console messages, DOM text, errors..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-700"
        />
        <button type="submit" className="px-4 py-2 bg-cyan-800 rounded text-sm hover:bg-cyan-700">Search</button>
      </form>

      {total > 0 && (
        <div className="grid grid-cols-4 gap-6">
          <div className="col-span-3 space-y-2">
            <div className="text-xs text-gray-500 mb-2">{total} results</div>
            {results.map((r, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{r.index}</span>
                  <span className="text-cyan-400 font-mono text-xs">{r.source?.url?.substring(0, 80)}</span>
                </div>
                <div className="text-gray-400 text-xs">
                  {r.source?.content?.substring(0, 200) || JSON.stringify(r.source).substring(0, 200)}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {Object.entries(aggregations).map(([name, agg]: any) => (
              <div key={name}>
                <h4 className="text-xs font-medium text-gray-500 mb-1 uppercase">{name}</h4>
                <div className="space-y-1">
                  {(agg.buckets || []).slice(0, 10).map((b: any) => (
                    <div key={b.key} className="flex justify-between text-xs">
                      <span className="text-gray-400">{b.key}</span>
                      <span className="text-gray-600">{b.doc_count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
