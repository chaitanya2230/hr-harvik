import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../auth/auth-context';
import { useManagerOptions } from '../employees/api';
import {
  downloadResume,
  useCandidate,
  useConvertCandidate,
  useScheduleInterview,
  useSubmitInterviewFeedback,
  useUpdateCandidateStage,
  useUpdateOffer,
  useUploadResume,
} from './api';

const STAGES = ['Applied', 'Shortlisted', 'Interview', 'Selected', 'Offer', 'Joined'];

export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const notify = useToast();
  const showToast = (message: string, kind: 'success' | 'error' = 'success') => notify(kind, message);
  const { account } = useAuth();

  const { data, isPending, isError, error, refetch } = useCandidate(id ?? '');
  const updateStage = useUpdateCandidateStage(id ?? '');
  const scheduleInterview = useScheduleInterview(id ?? '');
  const submitFeedback = useSubmitInterviewFeedback(id ?? '', 1);
  const updateOffer = useUpdateOffer(id ?? '');
  const uploadResume = useUploadResume(id ?? '');
  const convertCandidate = useConvertCandidate(id ?? '');

  const managersQuery = useManagerOptions();
  const managers = managersQuery.data?.data ?? [];

  // Modals state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [interviewTitle, setInterviewTitle] = useState('Technical Interview');
  const [interviewerId, setInterviewerId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  const [feedbackRound, setFeedbackRound] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(4);

  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerStatus, setOfferStatus] = useState('Sent');
  const [offerJoiningDate, setOfferJoiningDate] = useState('');

  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertEmploymentType, setConvertEmploymentType] = useState('Full-Time');
  const [convertJoiningDate, setConvertJoiningDate] = useState('');
  const [convertDesignation, setConvertDesignation] = useState('');
  const [createLogin, setCreateLogin] = useState(false);
  const [loginPassword, setLoginPassword] = useState('Harvik@123');

  const canManage = account?.permissions.includes('manageCandidates');
  const canAddFeedback = account?.permissions.includes('addInterviewFeedback');

  if (isPending) return <LoadingState label="Loading candidate profile…" />;
  if (isError || !data?.data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const cand = data.data;

  // Stage Advancement Handler
  const handleAdvanceStage = async (nextStage: string) => {
    try {
      await updateStage.mutateAsync({ stage: nextStage });
      showToast(`Candidate moved to ${nextStage}`, 'success');
      void refetch();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update stage', 'error');
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectReason.trim()) {
      showToast('Rejection reason is mandatory', 'error');
      return;
    }
    try {
      await updateStage.mutateAsync({ stage: 'Rejected', reason: rejectReason });
      showToast('Candidate rejected', 'success');
      setShowRejectModal(false);
      void refetch();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to reject candidate', 'error');
    }
  };

  const handleScheduleInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interviewerId || !scheduledAt) {
      showToast('Please select interviewer and schedule time', 'error');
      return;
    }
    try {
      await scheduleInterview.mutateAsync({
        title: interviewTitle,
        interviewerId,
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      showToast('Interview round scheduled', 'success');
      setShowScheduleModal(false);
      void refetch();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to schedule interview', 'error');
    }
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackRound || !feedbackText.trim()) {
      showToast('Please provide feedback commentary', 'error');
      return;
    }
    try {
      await submitFeedback.mutateAsync({
        feedback: feedbackText,
        rating: Number(feedbackRating),
      });
      showToast('Interview feedback submitted', 'success');
      setFeedbackRound(null);
      void refetch();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to submit feedback', 'error');
    }
  };

  const handleUpdateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateOffer.mutateAsync({
        offerStatus,
        joiningDate: offerJoiningDate || null,
      });
      showToast('Offer status updated', 'success');
      setShowOfferModal(false);
      void refetch();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update offer', 'error');
    }
  };

  const handleResumeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('resume', file);
    try {
      await uploadResume.mutateAsync(formData);
      showToast('Resume uploaded securely', 'success');
      void refetch();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to upload resume', 'error');
    }
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await convertCandidate.mutateAsync({
        employmentType: convertEmploymentType,
        dateOfJoining: convertJoiningDate || new Date().toISOString().slice(0, 10),
        designation: convertDesignation || cand.jobTitle || undefined,
        createLogin: createLogin
          ? {
              email: cand.email,
              password: loginPassword,
              role: 'Employee',
            }
          : undefined,
      });
      showToast(
        `Successfully converted to Employee ${res.data.employeeCode}! Onboarding initialized.`,
        'success',
      );
      setShowConvertModal(false);
      void refetch();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to convert candidate', 'error');
    }
  };

  const canConvert =
    !cand.convertedEmployeeId &&
    (cand.stage === 'Joined' || (cand.stage === 'Offer' && cand.offerStatus === 'Accepted'));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${cand.name} (${cand.candidateCode})`}
        subtitle={`Role: ${cand.jobTitle ?? 'Requisition'} · Source: ${cand.source} · Stage: ${cand.stage}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {cand.convertedEmployeeId ? (
              <Link
                to={`/employees/${cand.convertedEmployeeId}`}
                className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                View Converted Employee Record →
              </Link>
            ) : canConvert ? (
              <button
                type="button"
                onClick={() => {
                  setConvertJoiningDate(cand.joiningDate ?? new Date().toISOString().slice(0, 10));
                  setConvertDesignation(cand.jobTitle ?? '');
                  setShowConvertModal(true);
                }}
                className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
              >
                Convert to Employee
              </button>
            ) : null}

            {canManage && cand.stage !== 'Rejected' && !cand.convertedEmployeeId && (
              <button
                type="button"
                onClick={() => setShowRejectModal(true)}
                className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                Reject Candidate
              </button>
            )}
          </div>
        }
      />

      {/* Stage Progression Pipeline Bar */}
      <Card title="Recruitment Stage Pipeline">
        <div className="flex flex-wrap items-center gap-2">
          {STAGES.map((s, idx) => {
            const isCurrent = cand.stage === s;
            const isPast = STAGES.indexOf(cand.stage) > idx;
            return (
              <div key={s} className="flex items-center">
                <span
                  className={`flex items-center rounded-md px-3 py-1.5 text-xs font-semibold ${
                    isCurrent
                      ? 'bg-brand-600 text-white'
                      : isPast
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isPast ? '✓ ' : ''}
                  {s}
                </span>
                {idx < STAGES.length - 1 && <span className="mx-2 text-slate-300">→</span>}
              </div>
            );
          })}
          {cand.stage === 'Rejected' && (
            <span className="rounded-md bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-800">
              Rejected: {cand.rejectionReason}
            </span>
          )}
        </div>

        {canManage && !cand.convertedEmployeeId && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {cand.stage === 'Applied' && (
              <button
                type="button"
                onClick={() => void handleAdvanceStage('Shortlisted')}
                className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500"
              >
                Advance to Shortlisted →
              </button>
            )}
            {cand.stage === 'Shortlisted' && (
              <button
                type="button"
                onClick={() => void handleAdvanceStage('Interview')}
                className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500"
              >
                Advance to Interview Stage →
              </button>
            )}
            {cand.stage === 'Interview' && (
              <button
                type="button"
                onClick={() => void handleAdvanceStage('Selected')}
                className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500"
              >
                Mark Selected →
              </button>
            )}
            {cand.stage === 'Selected' && (
              <button
                type="button"
                onClick={() => void handleAdvanceStage('Offer')}
                className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500"
              >
                Proceed to Offer Stage →
              </button>
            )}
            {cand.stage === 'Offer' && (
              <button
                type="button"
                onClick={() => void handleAdvanceStage('Joined')}
                className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500"
              >
                Mark Joined →
              </button>
            )}
            {cand.stage === 'Rejected' && (
              <button
                type="button"
                onClick={() => void handleAdvanceStage('Shortlisted')}
                className="rounded bg-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-500"
              >
                Reconsider & Move to Shortlisted
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Basic Info & Resume */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Candidate Overview">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Email Address</dt>
              <dd className="font-medium text-slate-800">{cand.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Phone</dt>
              <dd className="font-medium text-slate-800">{cand.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Target Requisition</dt>
              <dd className="font-medium text-slate-800">
                <Link to={`/recruitment/jobs/${cand.jobId}`} className="text-brand-600 hover:underline">
                  {cand.jobTitle} ({cand.jobCode})
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Candidate Source</dt>
              <dd className="font-medium text-slate-800">{cand.source}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Selection Status</dt>
              <dd className="font-medium text-slate-800">{cand.selectionStatus}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Anticipated Joining</dt>
              <dd className="font-medium text-slate-800">{cand.joiningDate ?? 'Not set'}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Curriculum Vitae / Resume">
          {cand.resumeFile ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">{cand.resumeFile.originalName}</p>
                <p className="text-xs text-slate-500">
                  {(cand.resumeFile.sizeBytes / 1024).toFixed(1)} KB · Uploaded {cand.resumeFile.uploadedAt.split('T')[0]}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void downloadResume(cand.id, cand.resumeFile?.originalName)}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  Download Secure Resume
                </button>
                {canManage && (
                  <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    Replace File
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={(e) => void handleResumeFileChange(e)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">No resume document uploaded yet.</p>
              {canManage && (
                <label className="inline-block cursor-pointer rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">
                  Upload Resume (.pdf, .doc, .docx)
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={(e) => void handleResumeFileChange(e)}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Interviews Section */}
      <Card
        title="Interview Rounds & Feedback"
        children={
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-xs text-slate-500">
                Track interview scheduling, panel evaluations, and 1–5 candidate ratings.
              </p>
              {canManage && cand.stage !== 'Rejected' && (
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(true)}
                  className="rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  + Schedule Round
                </button>
              )}
            </div>

            {cand.interviews.length === 0 ? (
              <EmptyState title="No interview rounds scheduled yet" />
            ) : (
              <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {cand.interviews.map((iv) => (
                  <div key={iv.round} className="p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold text-sm text-slate-900">
                          Round {iv.round}: {iv.title}
                        </h4>
                        <p className="text-xs text-slate-500">
                          Interviewer: {iv.interviewerName ?? 'Assigned Team Member'} · Time: {iv.scheduledAt.replace('T', ' ').slice(0, 16)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          iv.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {iv.status}
                      </span>
                    </div>

                    {iv.feedback ? (
                      <div className="rounded bg-slate-50 p-2.5 text-xs text-slate-700">
                        <div className="font-semibold text-slate-900">
                          Rating: {iv.rating} / 5 ⭐
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{iv.feedback}</p>
                      </div>
                    ) : (
                      canAddFeedback && (
                        <button
                          type="button"
                          onClick={() => {
                            setFeedbackRound(iv.round);
                            setFeedbackText('');
                            setFeedbackRating(4);
                          }}
                          className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Submit Feedback
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        }
      />

      {/* Offer Section */}
      <Card title="Offer Management">
        <div className="flex justify-between items-center text-sm">
          <div>
            <p className="font-medium text-slate-800">
              Offer Status: <span className="font-bold text-indigo-700">{cand.offerStatus}</span>
            </p>
            <p className="text-xs text-slate-500">
              Confirmed Joining Date: {cand.joiningDate ?? 'Pending candidate decision'}
            </p>
          </div>
          {canManage && cand.stage !== 'Rejected' && (
            <button
              type="button"
              onClick={() => {
                setOfferStatus(cand.offerStatus === 'Pending' ? 'Sent' : cand.offerStatus);
                setOfferJoiningDate(cand.joiningDate || '');
                setShowOfferModal(true);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Update Offer Details
            </button>
          )}
        </div>
      </Card>

      {/* Stage History */}
      <Card title="Audit & Pipeline Progression History">
        <ol className="divide-y divide-slate-100 text-xs text-slate-600">
          {cand.stageHistory.map((h, i) => (
            <li key={i} className="py-2 flex justify-between">
              <div>
                <span className="font-semibold text-slate-800">{h.stage}</span>
                {h.note && <span className="text-slate-500"> — {h.note}</span>}
              </div>
              <span className="text-slate-400">{h.changedAt.split('T')[0]}</span>
            </li>
          ))}
        </ol>
      </Card>

      {/* Modals */}
      {/* 1. Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Reject Candidate</h3>
            <p className="text-xs text-slate-500">
              Please document the mandatory rejection reason for candidate audit records.
            </p>
            <form onSubmit={(e) => void handleReject(e)} className="space-y-3">
              <textarea
                rows={3}
                required
                placeholder="Reason for candidate rejection..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 p-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="rounded px-3 py-1.5 text-xs border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateStage.isPending}
                  className="rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Schedule Interview Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Schedule Interview Round</h3>
            <form onSubmit={(e) => void handleScheduleInterview(e)} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700">Round Title</label>
                <input
                  type="text"
                  required
                  value={interviewTitle}
                  onChange={(e) => setInterviewTitle(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Interviewer</label>
                <select
                  required
                  value={interviewerId}
                  onChange={(e) => setInterviewerId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Select interviewer</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} ({m.designation ?? 'Manager'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Scheduled Date & Time</label>
                <input
                  type="datetime-local"
                  required
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="rounded px-3 py-1.5 text-xs border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={scheduleInterview.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  Confirm Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Feedback Modal */}
      {feedbackRound !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Submit Feedback (Round {feedbackRound})
            </h3>
            <form onSubmit={(e) => void handleSubmitFeedback(e)} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700">Rating (1 to 5)</label>
                <select
                  value={feedbackRating}
                  onChange={(e) => setFeedbackRating(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value={5}>5 - Excellent Fit / Strong Hire</option>
                  <option value={4}>4 - Good Fit / Hire</option>
                  <option value={3}>3 - Average / Borderline</option>
                  <option value={2}>2 - Weak / Do Not Hire</option>
                  <option value={1}>1 - Strongly Reject</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Feedback Commentary</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Technical assessment, cultural alignment, strengths and development areas..."
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFeedbackRound(null)}
                  className="rounded px-3 py-1.5 text-xs border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitFeedback.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  Submit Evaluation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Offer Modal */}
      {showOfferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Update Offer Details</h3>
            <form onSubmit={(e) => void handleUpdateOffer(e)} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700">Offer Status</label>
                <select
                  value={offerStatus}
                  onChange={(e) => setOfferStatus(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="Pending">Pending</option>
                  <option value="Sent">Sent (Extended)</option>
                  <option value="Accepted">Accepted</option>
                  <option value="Declined">Declined</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Joining Date {offerStatus === 'Accepted' ? '*' : '(Optional)'}
                </label>
                <input
                  type="date"
                  required={offerStatus === 'Accepted'}
                  value={offerJoiningDate}
                  onChange={(e) => setOfferJoiningDate(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOfferModal(false)}
                  className="rounded px-3 py-1.5 text-xs border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateOffer.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  Save Offer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Convert Candidate Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Convert Candidate to Employee
            </h3>
            <p className="text-xs text-slate-500">
              This initiates an atomic MongoDB transaction: creating the Employee profile, 14-item
              onboarding checklist, and initial leave balances.
            </p>
            <form onSubmit={(e) => void handleConvert(e)} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700">Employment Type *</label>
                <select
                  value={convertEmploymentType}
                  onChange={(e) => setConvertEmploymentType(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="Full-Time">Full-Time</option>
                  <option value="Intern">Intern</option>
                  <option value="Freelancer">Freelancer</option>
                  <option value="Contractor">Contractor</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Date of Joining *</label>
                <input
                  type="date"
                  required
                  value={convertJoiningDate}
                  onChange={(e) => setConvertJoiningDate(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Designation *</label>
                <input
                  type="text"
                  required
                  value={convertDesignation}
                  onChange={(e) => setConvertDesignation(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={createLogin}
                    onChange={(e) => setCreateLogin(e.target.checked)}
                    className="rounded"
                  />
                  Create User Login Account Immediately
                </label>
                {createLogin && (
                  <div>
                    <label className="block text-xs text-slate-600">Initial Password</label>
                    <input
                      type="text"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConvertModal(false)}
                  className="rounded px-4 py-2 text-xs border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={convertCandidate.isPending}
                  className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {convertCandidate.isPending ? 'Converting…' : 'Execute Conversion'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
