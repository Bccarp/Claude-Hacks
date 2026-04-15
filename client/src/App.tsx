import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Room from "./pages/Room";
import Matches from "./pages/Matches";
import MatchDetail from "./pages/MatchDetail";
import RevealScreen from "./pages/RevealScreen";

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-slate-400">Loading…</div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!session)
    return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <Login />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Room />
              </RequireAuth>
            }
          />
          <Route
            path="/matches"
            element={
              <RequireAuth>
                <Matches />
              </RequireAuth>
            }
          />
          <Route
            path="/matches/:matchId"
            element={
              <RequireAuth>
                <MatchDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/matches/:matchId/reveal"
            element={
              <RequireAuth>
                <RevealScreen />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
