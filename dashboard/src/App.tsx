import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { SessionList } from './pages/SessionList';
import { SessionDetail } from './pages/SessionDetail';
import { SearchPage } from './pages/Search';
import { NetworkExplorer } from './pages/NetworkExplorer';
import { DomExplorer } from './pages/DomExplorer';
import { StorageExplorer } from './pages/StorageExplorer';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<SessionList />} />
            <Route path="/session/:id" element={<SessionDetail />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/network" element={<NetworkExplorer />} />
            <Route path="/dom" element={<DomExplorer />} />
            <Route path="/storage" element={<StorageExplorer />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
