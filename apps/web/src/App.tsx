import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthProvider';
import { useAuth } from './features/auth/auth-context';
import { LoginPage } from './features/auth/LoginPage';

/**
 * AGENTS.md §16 P0 — the shell is intentionally limited to authentication.
 *
 * There are no employee, dashboard, leave or document screens yet; those are
 * P1+ and must read real API data, so nothing here renders placeholder metrics.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { account, initialising } = useAuth();

  if (initialising) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  // Unauthenticated users are redirected to /login (AGENTS.md §9).
  if (!account) return <Navigate to="/login" replace state={{ from: window.location.pathname }} />;

  return <>{children}</>;
}

function HomePage() {
  const { account, signOut } = useAuth();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Harvik HR</h1>
            <p className="mt-1 text-sm text-slate-500">
              Signed in as {account?.email} · {account?.role}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Sign out
          </button>
        </header>

        <section
          aria-label="Phase status"
          className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600"
        >
          <h2 className="text-base font-medium text-slate-900">Foundation ready</h2>
          <p className="mt-1">
            Authentication, RBAC and the operational endpoints are live. Employee, dashboard,
            leave, document and asset screens arrive in the later build phases.
          </p>
        </section>
      </div>
    </main>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}