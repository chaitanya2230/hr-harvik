import { useMutation, useQuery } from '@tanstack/react-query';
import { apiDownload, apiRequest } from '../../api/client';

/**
 * AGENTS.md §8.11 — report data access. JSON for on-screen tables, direct
 * file download for CSV/XLSX, polling for BullMQ-queued large exports.
 */

export interface ReportColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ReportResponse {
  data: Array<Record<string, unknown>>;
  meta: {
    title: string;
    reportType: string;
    columns: ReportColumn[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    [key: string]: unknown;
  };
}

export interface ReportFilters {
  departmentId?: string;
  employmentType?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  joiningFrom?: string;
  joiningTo?: string;
}

export interface ExportJobStatus {
  jobId: string;
  status: 'pending' | 'completed' | 'failed';
  format: 'csv' | 'xlsx';
  filename: string;
  error?: string;
  createdAt: string;
}

export const REPORT_TYPES = [
  { key: 'employees', label: 'Employee report' },
  { key: 'new-joiners', label: 'New joiner report' },
  { key: 'exits', label: 'Employee exit report' },
  { key: 'attendance', label: 'Attendance report' },
  { key: 'leave', label: 'Leave report' },
  { key: 'assets', label: 'Asset report' },
  { key: 'licenses', label: 'Software / license report' },
  { key: 'pending-asset-returns', label: 'Pending asset returns' },
  { key: 'pending-license-revocations', label: 'Pending license revocations' },
  { key: 'cost-summary', label: 'Employee cost summary' },
  { key: 'department-counts', label: 'Department-wise employee count' },
] as const;

export type ReportKey = (typeof REPORT_TYPES)[number]['key'];

function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function useReport(
  type: ReportKey | null,
  filters: ReportFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: ['reports', type, filters],
    queryFn: () =>
      apiRequest<ReportResponse>(
        `/reports/${type}${toQueryString(filters as Record<string, string | undefined>)}`,
      ),
    enabled: enabled && type !== null,
  });
}

export function useExportDownload() {
  return useMutation({
    mutationFn: async ({
      type,
      format,
      filters,
    }: {
      type: ReportKey;
      format: 'csv' | 'xlsx';
      filters: ReportFilters;
    }) => {
      await apiDownload(
        `/reports/${type}/export${toQueryString({ ...(filters as Record<string, string | undefined>), format })}`,
        `${type}-report.${format}`,
      );
    },
  });
}

export function useQueuedExport() {
  return useMutation({
    mutationFn: async ({
      type,
      format,
      filters,
    }: {
      type: ReportKey;
      format: 'csv' | 'xlsx';
      filters: ReportFilters;
    }) => {
      const started = await apiRequest<{ data: { jobId: string; filename: string } }>(
        `/reports/${type}/export${toQueryString({ ...(filters as Record<string, string | undefined>), format, async: 'true' })}`,
      );
      return started.data;
    },
  });
}

export function useExportJobStatus(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['report-export', jobId],
    queryFn: () =>
      apiRequest<{ data: ExportJobStatus }>(`/reports/exports/${jobId}`),
    enabled: enabled && jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.data.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    },
  });
}
