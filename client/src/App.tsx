import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./pages/Login";
import OnboardProfile from "./pages/OnboardProfile";
import Room from "./pages/Room";

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-slate-400">Loading…</div>
    </div>
  );
}

function MatchesPlaceholder() {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Matches</h1>
          <button
            onClick={signOut}
            className="text-slate-400 hover:text-white text-sm"
          >
            Sign out
          </button>
        </div>
        <p className="text-slate-400 text-sm">
          Matches list is coming in the next task.
        </p>
      </div>
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

function RequireProfile({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!profile) return <Navigate to="/onboard" replace />;
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
            path="/onboard"
            element={
              <RequireAuth>
                <OnboardProfile />
              </RequireAuth>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <RequireProfile>
                  <Room />
                </RequireProfile>
              </RequireAuth>
            }
          />
          <Route
            path="/matches"
            element={
              <RequireAuth>
                <RequireProfile>
                  <MatchesPlaceholder />
                </RequireProfile>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
