import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../../components/ui';
import { ApiError } from '../../api/client';
import {
  REPORT_TYPES,
  useExportDownload,
  useQueuedExport,
  useExportJobStatus,
  useReport,
  type ReportFilters,
  type ReportKey,
} from './api';

/**
 * AGENTS.md §8.11 + §9 — Reports page. Every table renders server data with
 * loading/empty/error states; CSV/XLSX download directly, large exports poll
 * a BullMQ job. Cost data never renders for non-HR roles (the backend
 * refuses with 403; the selector hides the option too).
 */

const COST_REPORT: ReportKey = 'cost-summary';

function isHrRole(role: string | undefined): boolean {
  return role === 'HR Admin' || role === 'HR Manager';
}

export function ReportsPage() {
  const { account } = useAuth();
  const notify = useToast();
  const hr = isHrRole(account?.role);

  const [reportType, setReportType] = useState<ReportKey>('employees');
  const [filters, setFilters] = useState<ReportFilters>({});
  const [queuedJobId, setQueuedJobId] = useState<string | null>(null);

  const reportQuery = useReport(hr || reportType !== COST_REPORT ? reportType : null, filters);
  const downloadMutation = useExportDownload();
  const queueMutation = useQueuedExport();
  const jobQuery = useExportJobStatus(queuedJobId, queuedJobId !== null);

  const setFilter = (key: keyof ReportFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }));
    setQueuedJobId(null);
  };

  const handleDownload = async (format: 'csv' | 'xlsx'): Promise<void> => {
    try {
      await downloadMutation.mutateAsync({ type: reportType, format, filters });
      notify('success', `${format.toUpperCase()} download started`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleQueuedExport = async (format: 'csv' | 'xlsx'): Promise<void> => {
    try {
      const started = await queueMutation.mutateAsync({ type: reportType, format, filters });
      setQueuedJobId(started.jobId);
      notify('success', 'Large export queued — status will update automatically');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to queue export');
    }
  };

  const handleJobDownload = async (): Promise<void> => {
    if (!queuedJobId) return;
    try {
      const { apiDownload } = await import('../../api/client');
      await apiDownload(
        `/reports/exports/${queuedJobId}?download=true`,
        jobQuery.data?.data.filename ?? `report.${jobQuery.data?.data.format ?? 'csv'}`,
      );
      notify('success', 'Export downloaded');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Download failed');
    }
  };

  const columns = reportQuery.data?.meta.columns ?? [];
  const rows = (reportQuery.data?.data ?? []) as Array<Record<string, unknown>>;
  const jobStatus = jobQuery.data?.data.status;

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Operational reports across HR modules — JSON on screen, CSV/XLSX on export"
      />

      <Card title="Report">
        <div className="flex flex-wrap gap-2">
          <label htmlFor="report-type" className="sr-only">Report type</label>
          <select
            id="report-type"
            value={reportType}
            onChange={(event) => {
              setReportType(event.target.value as ReportKey);
              setQueuedJobId(null);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {REPORT_TYPES.filter((r) => hr || r.key !== COST_REPORT).map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          <label htmlFor="filter-start" className="sr-only">Start date</label>
          <input
            id="filter-start"
            type="date"
            value={filters.startDate ?? ''}
            onChange={(event) => setFilter('startDate', event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <label htmlFor="filter-end" className="sr-only">End date</label>
          <input
            id="filter-end"
            type="date"
            value={filters.endDate ?? ''}
            onChange={(event) => setFilter('endDate', event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <label htmlFor="filter-status" className="sr-only">Status</label>
          <input
            id="filter-status"
            value={filters.status ?? ''}
            onChange={(event) => setFilter('status', event.target.value)}
            placeholder="Status"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={downloadMutation.isPending}
            onClick={() => void handleDownload('csv')}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Download CSV
          </button>
          <button
            type="button"
            disabled={downloadMutation.isPending}
            onClick={() => void handleDownload('xlsx')}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Download XLSX
          </button>
          <button
            type="button"
            disabled={queueMutation.isPending}
            onClick={() => void handleQueuedExport('csv')}
            title="Large exports run on the background queue"
            className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Queue large export (BullMQ)
          </button>
        </div>

        {queuedJobId ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm" role="status">
            {jobStatus === 'completed' ? (
              <>
                Export ready.{' '}
                <button type="button" onClick={() => void handleJobDownload()} className="font-medium text-brand-700 hover:underline">
                  Download file
                </button>
              </>
            ) : jobStatus === 'failed' ? (
              <>Export failed. Please retry.</>
            ) : (
              <>Export queued… status updates automatically.</>
            )}
          </div>
        ) : null}
      </Card>

      <div className="mt-4">
        {reportQuery.isPending ? (
          <LoadingState label="Loading report…" />
        ) : reportQuery.isError ? (
          <ErrorState
            error={reportQuery.error instanceof ApiError && reportQuery.error.status === 403
              ? new Error('You do not have access to this report')
              : reportQuery.error}
            onRetry={() => void reportQuery.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No rows" hint="Adjust the filters or date range and try again." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  {columns.map((col) => (
                    <th key={col.key} scope="col" className="px-4 py-2.5">{col.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, index) => (
                  <tr key={index} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-2.5 text-slate-700">
                        {String(row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 ? (
              <p className="px-4 py-2 text-xs text-slate-500">
                Showing first 100 of {rows.length} rows — download the file for the full report.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
