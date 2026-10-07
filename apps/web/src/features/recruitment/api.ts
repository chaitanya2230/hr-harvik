import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiRequest } from '../../api/client';
import type { ListResponse } from '../../api/types';
import type { Candidate, ConversionResult, Job } from './types';

export function useJobs(params: {
  page?: number;
  limit?: number;
  departmentId?: string;
  status?: string;
  q?: string;
}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.departmentId) query.set('departmentId', params.departmentId);
  if (params.status) query.set('status', params.status);
  if (params.q) query.set('q', params.q);

  return useQuery({
    queryKey: ['recruitment', 'jobs', params],
    queryFn: () => apiRequest<ListResponse<Job>>(`/recruitment/jobs?${query.toString()}`),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ['recruitment', 'jobs', id],
    queryFn: () => apiRequest<{ data: Job }>(`/recruitment/jobs/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Job>) =>
      apiRequest<{ data: Job }>('/recruitment/jobs', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateJob(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Job>) =>
      apiRequest<{ data: Job }>(`/recruitment/jobs/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteJob(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>(`/recruitment/jobs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCandidates(params: {
  page?: number;
  limit?: number;
  jobId?: string;
  stage?: string;
  source?: string;
  q?: string;
}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.jobId) query.set('jobId', params.jobId);
  if (params.stage) query.set('stage', params.stage);
  if (params.source) query.set('source', params.source);
  if (params.q) query.set('q', params.q);

  return useQuery({
    queryKey: ['recruitment', 'candidates', params],
    queryFn: () =>
      apiRequest<ListResponse<Candidate>>(`/recruitment/candidates?${query.toString()}`),
  });
}

export function useCandidate(id: string) {
  return useQuery({
    queryKey: ['recruitment', 'candidates', id],
    queryFn: () => apiRequest<{ data: Candidate }>(`/recruitment/candidates/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Candidate>) =>
      apiRequest<{ data: Candidate }>('/recruitment/candidates', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'candidates'] });
    },
  });
}

export function useUpdateCandidateStage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { stage: string; note?: string; reason?: string }) =>
      apiRequest<{ data: Candidate }>(`/recruitment/candidates/${id}/stage`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'candidates'] });
    },
  });
}

export function useScheduleInterview(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; interviewerId: string; scheduledAt: string }) =>
      apiRequest<{ data: Candidate }>(`/recruitment/candidates/${id}/interviews`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'candidates'] });
    },
  });
}

export function useSubmitInterviewFeedback(id: string, round: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { feedback: string; rating: number }) =>
      apiRequest<{ data: Candidate }>(
        `/recruitment/candidates/${id}/interviews/${round}/feedback`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'candidates'] });
    },
  });
}

export function useUpdateOffer(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { offerStatus: string; joiningDate?: string | null }) =>
      apiRequest<{ data: Candidate }>(`/recruitment/candidates/${id}/offer`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'candidates'] });
    },
  });
}

export function useUploadResume(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      apiRequest<{ data: Candidate }>(`/recruitment/candidates/${id}/resume`, {
        method: 'POST',
        body: formData,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'candidates'] });
    },
  });
}

export function downloadResume(id: string, filename = 'resume.pdf') {
  return apiDownload(`/recruitment/candidates/${id}/resume`, filename);
}

export function useConvertCandidate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      employmentType: string;
      dateOfJoining: string;
      designation?: string;
      departmentId?: string;
      reportingManagerId?: string;
      compensation?: { amount?: number; currency?: string; period?: string };
      createLogin?: { email: string; password?: string; role: string };
    }) =>
      apiRequest<{ data: ConversionResult }>(`/recruitment/candidates/${id}/convert`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['recruitment', 'jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
