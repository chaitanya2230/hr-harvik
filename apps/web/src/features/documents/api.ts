import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiDownload, apiRequest } from '../../api/client';
import type {
  DocumentItem,
  DocumentTemplateItem,
  ItemResponse,
  ListResponse,
} from '../../api/types';

export interface DocumentListParams {
  page?: number;
  limit?: number;
  employeeId?: string;
  category?: string;
  confidential?: boolean;
  source?: string;
  expiringBefore?: string;
  search?: string;
}

const toSearchParams = (params: object): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

export const documentKeys = {
  all: ['documents'] as const,
  list: (params: DocumentListParams) => ['documents', 'list', params] as const,
  detail: (id: string) => ['documents', 'detail', id] as const,
  history: (id: string) => ['documents', 'history', id] as const,
  templates: (params?: { category?: string; isActive?: boolean }) =>
    ['documentTemplates', params] as const,
  templateDetail: (id: string) => ['documentTemplates', 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// Document Queries & Mutations
// ---------------------------------------------------------------------------

export function useDocuments(
  params: DocumentListParams = {},
  enabled = true,
): UseQueryResult<ListResponse<DocumentItem>> {
  return useQuery({
    queryKey: documentKeys.list(params),
    queryFn: () => apiRequest<ListResponse<DocumentItem>>(`/documents?${toSearchParams(params)}`),
    enabled,
  });
}

export function useDocument(id: string | undefined): UseQueryResult<ItemResponse<DocumentItem>> {
  return useQuery({
    queryKey: documentKeys.detail(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<DocumentItem>>(`/documents/${id}`),
    enabled: Boolean(id),
  });
}

export function useDocumentHistory(id: string | undefined): UseQueryResult<ItemResponse<DocumentItem[]>> {
  return useQuery({
    queryKey: documentKeys.history(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<DocumentItem[]>>(`/documents/${id}/history`),
    enabled: Boolean(id),
  });
}

export async function downloadDocument(id: string, originalName?: string): Promise<void> {
  await apiDownload(`/documents/${id}/file`, originalName || 'document.pdf');
}

export function useUploadDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      apiRequest<ItemResponse<DocumentItem>>('/documents', {
        method: 'POST',
        body: formData,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: documentKeys.all });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUploadDocumentVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      apiRequest<ItemResponse<DocumentItem>>(`/documents/${id}/versions`, {
        method: 'POST',
        body: formData,
      }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: documentKeys.all });
      void client.invalidateQueries({ queryKey: documentKeys.history(variables.id) });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/documents/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: documentKeys.all });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Document Template Queries & Mutations
// ---------------------------------------------------------------------------

export function useDocumentTemplates(
  params?: { category?: string; isActive?: boolean },
  enabled = true,
): UseQueryResult<ItemResponse<DocumentTemplateItem[]>> {
  return useQuery({
    queryKey: documentKeys.templates(params),
    queryFn: () =>
      apiRequest<ItemResponse<DocumentTemplateItem[]>>(
        `/document-templates${params ? `?${toSearchParams(params)}` : ''}`,
      ),
    enabled,
  });
}

export function useDocumentTemplate(
  id: string | undefined,
): UseQueryResult<ItemResponse<DocumentTemplateItem>> {
  return useQuery({
    queryKey: documentKeys.templateDetail(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<DocumentTemplateItem>>(`/document-templates/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateDocumentTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      category: string;
      applicableEmploymentTypes: string[];
      bodyHtml: string;
      isActive?: boolean;
    }) =>
      apiRequest<ItemResponse<DocumentTemplateItem>>('/document-templates', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documentTemplates'] });
    },
  });
}

export function useUpdateDocumentTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: {
        name?: string;
        category?: string;
        applicableEmploymentTypes?: string[];
        bodyHtml?: string;
        isActive?: boolean;
      };
    }) =>
      apiRequest<ItemResponse<DocumentTemplateItem>>(`/document-templates/${id}`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ['documentTemplates'] });
      void client.invalidateQueries({ queryKey: documentKeys.templateDetail(variables.id) });
    },
  });
}

export function useDeleteDocumentTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/document-templates/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documentTemplates'] });
    },
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: ({ id, employeeId }: { id: string; employeeId: string }) =>
      apiRequest<ItemResponse<{ renderedHtml: string; context: Record<string, unknown> }>>(
        `/document-templates/${id}/preview`,
        {
          method: 'POST',
          body: { employeeId },
        },
      ),
  });
}

export function useGenerateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      employeeId,
      title,
      confidential,
    }: {
      templateId: string;
      employeeId: string;
      title?: string;
      confidential?: boolean;
    }) =>
      apiRequest<ItemResponse<DocumentItem>>(`/document-templates/${templateId}/generate`, {
        method: 'POST',
        body: { employeeId, title, confidential },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: documentKeys.all });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['exit'] });
    },
  });
}
