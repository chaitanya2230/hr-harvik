import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';
import { useEmployeeList } from '../features/employees/api';

/**
 * AGENTS.md §9 — global employee search in the top bar.
 *
 * Advisory: results are limited by the backend's own scoping on
 * `GET /employees` (HR → all, Manager → team, Employee → refused), so this
 * component only ever renders what the server already allowed. Gated on
 * `viewEmployeeDirectory`, the same permission as the sidebar entry.
 */
export function GlobalEmployeeSearch() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const canSearch = account?.permissions.includes('viewEmployeeDirectory') ?? false;

  // Debounce keystrokes so a short pause types nothing extra to the API.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => setQuery(trimmed), 300);
    return () => window.clearTimeout(timer);
  }, [term]);

  const active = canSearch && query.length >= 2;
  const results = useEmployeeList({ page: 1, limit: 8, q: query }, active);
  const rows = active ? (results.data?.data ?? []) : [];

  // Close when clicking anywhere outside the search box.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (!canSearch) return null;

  const choose = (employeeId: string): void => {
    setOpen(false);
    setTerm('');
    setQuery('');
    navigate(`/employees/${employeeId}`);
  };

  const showPanel = open && query.length >= 2;

  return (
    <div ref={containerRef} className="relative w-72 max-w-full">
      <label htmlFor="global-employee-search" className="sr-only">
        Search employees by name, code, email or phone
      </label>
      <input
        id="global-employee-search"
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-employee-search-results"
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search employees…"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          const first = rows[0];
          if (event.key === 'Enter' && first) {
            event.preventDefault();
            choose(first.id);
          }
        }}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500"
      />
      {showPanel ? (
        <div
          id="global-employee-search-results"
          role="listbox"
          aria-label="Employee search results"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {results.isPending ? (
            <p className="px-3 py-2 text-sm text-slate-500" role="status">
              Searching…
            </p>
          ) : results.isError ? (
            <p className="px-3 py-2 text-sm text-red-600" role="alert">
              Search failed. Try again.
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No employees found.</p>
          ) : (
            rows.map((employee) => (
              <button
                key={employee.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => choose(employee.id)}
                className="block w-full px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              >
                <span className="text-sm font-medium text-slate-900">{employee.fullName}</span>
                <span className="ml-2 text-xs text-slate-400">{employee.employeeCode}</span>
                {employee.designation ? (
                  <span className="block truncate text-xs text-slate-500">
                    {employee.designation}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
