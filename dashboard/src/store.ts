import { create } from 'zustand';

interface AppState {
  token: string | null;
  user: string | null;
  roles: string[];
  setAuth: (token: string, user: string, roles: string[]) => void;
  logout: () => void;
  selectedSession: string | null;
  setSelectedSession: (id: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  token: localStorage.getItem('token'),
  user: null,
  roles: [],
  setAuth: (token, user, roles) => {
    localStorage.setItem('token', token);
    set({ token, user, roles });
  },
  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null, roles: [] });
  },
  selectedSession: null,
  setSelectedSession: (id) => set({ selectedSession: id }),
}));
