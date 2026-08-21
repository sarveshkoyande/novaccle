import { BrowserRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSessionStore } from './stores/useSessionStore';
import LoginScreen from './components/LoginScreen';
import AppShell from './components/AppShell';
import RequestsPage from './pages/RequestsPage';
import RequestDetailPage from './pages/RequestDetailPage';
import CalendarPage from './pages/CalendarPage';
import AdminPage from './pages/AdminPage';
import PlaceholderPage from './pages/PlaceholderPage';

const queryClient = new QueryClient();

// Real routes replace the old show*()/'.view.on' class-toggling — see
// accelerate-app/public/index.html's showLanding/openRequest/showPlan/
// showAdmin for the 1:1 mapping this route map is ported from.
function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<RequestsPage />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="analytics" element={<PlaceholderPage title="Analytics" />} />
        <Route path="assets" element={<PlaceholderPage title="Assets" />} />
      </Route>
    </Routes>
  );
}

function App() {
  const loggedIn = useSessionStore((s) => s.loggedIn);

  return (
    <QueryClientProvider client={queryClient}>
      {!loggedIn && <LoginScreen />}
      {loggedIn && (
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      )}
    </QueryClientProvider>
  );
}

export default App;
