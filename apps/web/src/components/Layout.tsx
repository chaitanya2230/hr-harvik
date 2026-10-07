import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { GlobalEmployeeSearch } from './GlobalEmployeeSearch';

/**
 * AGENTS.md §9 — application shell: left sidebar, top bar, role-filtered
 * navigation. Hiding is advisory only; the backend re-checks every capability.
 */

interface NavItem {
  to: string;
  label: string;
  /** Advisory permission; absent means every signed-in role sees it. */
  permission?: string;
  /** Advisory role allow-list; absent means all roles. Backend stays authoritative. */
  roles?: string[];
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/employees', label: 'Employees', permission: 'viewEmployeeDirectory' },
  { to: '/recruitment/jobs', label: 'Jobs', permission: 'viewRecruitment' },
  { to: '/recruitment/candidates', label: 'Candidates', permission: 'viewRecruitment' },
  { to: '/onboarding', label: 'Onboarding' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/leave', label: 'Leave' },
  { to: '/documents', label: 'Documents' },
  { to: '/assets', label: 'Assets' },
  { to: '/licenses', label: 'Licenses' },
  { to: '/exit', label: 'Exit / Offboarding' },
  { to: '/reports', label: 'Reports', roles: ['HR Admin', 'HR Manager', 'Manager'] },
  { to: '/notifications', label: 'Notifications' },
  { to: '/settings', label: 'Settings', permission: 'manageSettings' },
  { to: '/me', label: 'My Profile' },
];

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  `block rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

export function Layout() {
  const { account, signOut } = useAuth();
  const navigate = useNavigate();

  const visible = NAV.filter(
    (item) =>
      (!item.permission || account?.permissions.includes(item.permission)) &&
      (!item.roles || (account?.role && item.roles.includes(account.role))),
  );

  const onSignOut = async (): Promise<void> => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white" aria-label="Primary">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-base font-semibold text-slate-900">Harvik HR</p>
          <p className="mt-0.5 text-xs text-slate-500">{account?.role}</p>
        </div>
        <nav className="space-y-1 p-3">
          {visible.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <p className="truncate text-sm text-slate-600">
            Signed in as <span className="font-medium text-slate-900">{account?.email}</span>
          </p>
          <GlobalEmployeeSearch />
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
