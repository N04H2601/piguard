type Listener = () => void;

interface AppState {
  authenticated: boolean;
  username: string;
  currentRoute: string;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  kioskMode: boolean;
  theme: string;
  systemData: any | null;
  anomalies: Record<string, any>;
  wsConnected: boolean;
  activeAlerts: number;
  servicesDown: number;
  authError: string | null;
}

const state: AppState = {
  authenticated: false,
  username: '',
  currentRoute: 'dashboard',
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  kioskMode: localStorage.getItem('piguard_kiosk') === '1',
  theme: localStorage.getItem('piguard_theme') ?? 'default',
  systemData: null,
  anomalies: {},
  wsConnected: false,
  activeAlerts: 0,
  servicesDown: 0,
  authError: null,
};

const listeners = new Set<Listener>();

export function getState(): Readonly<AppState> {
  return state;
}

export function setState(updates: Partial<AppState>) {
  Object.assign(state, updates);
  if (updates.theme) {
    localStorage.setItem('piguard_theme', updates.theme);
  }
  if (updates.kioskMode !== undefined) {
    localStorage.setItem('piguard_kiosk', updates.kioskMode ? '1' : '0');
  }
  applyUiState();
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

function applyUiState() {
  if (state.theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', state.theme);
  }
  document.documentElement.toggleAttribute('data-kiosk', state.kioskMode);
}

applyUiState();
