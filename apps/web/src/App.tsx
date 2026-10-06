import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthProvider';
import { useAuth } from './features/auth/auth-context';
import { LoginPage } from './features/auth/LoginPage';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { EmployeeDetailPage } from './features/employees/EmployeeDetailPage';
import { EmployeeEditPage } from './features/employees/EmployeeEditPage';
import { EmployeeForm } from './features/employees/EmployeeForm';
import { EmployeeListPage } from './features/employees/EmployeeListPage';
import { MyProfilePage } from './features/employees/MyProfilePage';
import { AssetDetailPage } from './features/assets/AssetDetailPage';
import { AssetEditPage } from './features/assets/AssetEditPage';
import { AssetForm } from './features/assets/AssetForm';
import { AssetListPage } from './features/assets/AssetListPage';
import { LicenseDetailPage } from './features/licenses/LicenseDetailPage';
import { LicenseEditPage } from './features/licenses/LicenseEditPage';
import { LicenseForm } from './features/licenses/LicenseForm';
import { LicenseListPage } from './features/licenses/LicenseListPage';

/**
 * AGENTS.md §9 — P1 routes.
 *
 * `/employees/*` requires the directory capability; the guard here mirrors the
 * backend so unauthorised users never see the screen — but the backend remains
 * authoritative and refuses them anyway.
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

function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { account } = useAuth();
  if (!account?.permissions.includes(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route
              path="employees"
              element={
                <RequirePermission permission="viewEmployeeDirectory">
                  <EmployeeListPage />
                </RequirePermission>
              }
            />
            <Route
              path="employees/new"
              element={
                <RequirePermission permission="createEmployee">
                  <EmployeeForm />
                </RequirePermission>
              }
            />
            <Route path="employees/:id" element={<EmployeeDetailPage />} />
            <Route
              path="employees/:id/edit"
              element={
                <RequirePermission permission="updateEmployee">
                  <EmployeeEditPage />
                </RequirePermission>
              }
            />
            <Route path="me" element={<MyProfilePage />} />
            {/* List pages stay open: the inventory tabs gate themselves to HR
                while the assignment ledgers are scoped per role server-side. */}
            <Route path="assets" element={<AssetListPage />} />
            <Route
              path="assets/new"
              element={
                <RequirePermission permission="manageAssets">
                  <AssetForm />
                </RequirePermission>
              }
            />
            <Route
              path="assets/:id"
              element={
                <RequirePermission permission="manageAssets">
                  <AssetDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="assets/:id/edit"
              element={
                <RequirePermission permission="manageAssets">
                  <AssetEditPage />
                </RequirePermission>
              }
            />
            <Route path="licenses" element={<LicenseListPage />} />
            <Route
              path="licenses/new"
              element={
                <RequirePermission permission="manageLicenses">
                  <LicenseForm />
                </RequirePermission>
              }
            />
            <Route
              path="licenses/:id"
              element={
                <RequirePermission permission="manageLicenses">
                  <LicenseDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="licenses/:id/edit"
              element={
                <RequirePermission permission="manageLicenses">
                  <LicenseEditPage />
                </RequirePermission>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
