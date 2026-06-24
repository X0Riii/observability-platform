import { NavLink } from 'react-router-dom';
import { useStore } from '../store';

export function Layout({ children }: { children: React.ReactNode }) {
  const { token, user, logout } = useStore();

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-cyan-400">OBS</h1>
          <p className="text-xs text-gray-500">Observability Platform</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {[
            { to: '/', label: 'Sessions', icon: '◉' },
            { to: '/search', label: 'Search', icon: '⌕' },
            { to: '/network', label: 'Network', icon: '⤇' },
            { to: '/dom', label: 'DOM Explorer', icon: '⟐' },
            { to: '/storage', label: 'Storage', icon: '◻' },
          ].map(({ to, label, icon }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded text-sm ${isActive ? 'bg-cyan-900/30 text-cyan-300' : 'text-gray-400 hover:bg-gray-800'}`
              }>
              <span>{icon}</span> {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          {token ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{user}</span>
              <button onClick={logout} className="text-xs text-red-400 hover:text-red-300">Logout</button>
            </div>
          ) : (
            <a href="/login" className="text-xs text-cyan-400 hover:text-cyan-300">Login</a>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
