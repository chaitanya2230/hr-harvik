import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui';
import {
  downloadDocument,
  useDeleteDocument,
  useDocumentHistory,
  useDocuments,
  useDocumentTemplates,
  useGenerateDocument,
  usePreviewTemplate,
  useUploadDocument,
  useUploadDocumentVersion,
} from './api';
import type { DocumentCategory, DocumentItem, DocumentTemplateItem } from '../../api/types';

const CATEGORIES: DocumentCategory[] = [
  'Offer Letter',
  'Agreement',
  'NDA',
  'Experience Certificate',
  'Relieving Letter',
  'Appraisal',
  'Identity',
  'Education',
  'Other',
];

export function EmployeeDocumentsTab({ employeeId }: { employeeId: string }) {
  const { account } = useAuth();
  const notify = useToast();

  const isHr = account?.role === 'HR Admin' || account?.role === 'HR Manager';

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [versionModalDoc, setVersionModalDoc] = useState<DocumentItem | null>(null);
  const [historyModalDocId, setHistoryModalDocId] = useState<string | null>(null);

  const docsQuery = useDocuments({ employeeId, limit: 100 });
  const templatesQuery = useDocumentTemplates(undefined, generateModalOpen);

  const uploadDocMut = useUploadDocument();
  const uploadVersionMut = useUploadDocumentVersion();
  const deleteDocMut = useDeleteDocument();
  const previewTplMut = usePreviewTemplate();
  const generateDocMut = useGenerateDocument();

  const handleDownload = async (doc: DocumentItem) => {
    try {
      await downloadDocument(doc.id, doc.file.originalName);
      notify('success', 'Download started');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleDelete = async (doc: DocumentItem) => {
    if (!window.confirm(`Are you sure you want to delete "${doc.title}"?`)) return;
    try {
      await deleteDocMut.mutateAsync(doc.id);
      notify('success', 'Document deleted');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  if (docsQuery.isLoading) return <LoadingState label="Loading employee documents…" />;
  if (docsQuery.isError) {
    return <ErrorState error={docsQuery.error} onRetry={() => void docsQuery.refetch()} />;
  }

  const docs = docsQuery.data?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-slate-200">
        <div>
          <h3 className="font-semibold text-slate-900">Employee Documents</h3>
          <p className="text-xs text-slate-500">
            Official agreements, certificates, identity verification, and letters.
          </p>
        </div>
        {isHr && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGenerateModalOpen(true)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
            >
              Generate Document
            </button>
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Upload Document
            </button>
          </div>
        )}
      </div>

      {docs.length === 0 ? (
        <EmptyState
          title="No documents uploaded yet"
          hint="Use the buttons above to upload an agreement or generate an official letter."
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Category & Title</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Confidential</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{doc.title}</p>
                    <p className="text-xs text-slate-500">{doc.category}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      v{doc.version}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        doc.source === 'Generated'
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {doc.source}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {doc.confidential ? (
                      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Confidential
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{doc.expiryDate || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownload(doc)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-800"
                      >
                        Download
                      </button>
                      {isHr && (
                        <button
                          type="button"
                          onClick={() => setVersionModalDoc(doc)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-800"
                        >
                          New Version
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setHistoryModalDocId(doc.id)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700"
                      >
                        History
                      </button>
                      {isHr && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(doc)}
                          className="text-xs font-medium text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload modal for this employee */}
      {uploadModalOpen && (
        <DirectUploadModal
          employeeId={employeeId}
          onClose={() => setUploadModalOpen(false)}
          onUpload={async (fd) => {
            try {
              await uploadDocMut.mutateAsync(fd);
              notify('success', 'Document uploaded successfully');
              setUploadModalOpen(false);
            } catch (err: unknown) {
              notify('error', err instanceof Error ? err.message : 'Upload failed');
            }
          }}
          isSubmitting={uploadDocMut.isPending}
        />
      )}

      {/* Version upload modal */}
      {versionModalDoc && (
        <DirectVersionModal
          doc={versionModalDoc}
          onClose={() => setVersionModalDoc(null)}
          onUpload={async (fd) => {
            try {
              await uploadVersionMut.mutateAsync({ id: versionModalDoc.id, formData: fd });
              notify('success', 'New version uploaded');
              setVersionModalDoc(null);
            } catch (err: unknown) {
              notify('error', err instanceof Error ? err.message : 'Upload failed');
            }
          }}
          isSubmitting={uploadVersionMut.isPending}
        />
      )}

      {/* History modal */}
      {historyModalDocId && (
        <DirectHistoryModal
          documentId={historyModalDocId}
          onClose={() => setHistoryModalDocId(null)}
          onDownload={handleDownload}
        />
      )}

      {/* Generate modal for this employee */}
      {generateModalOpen && (
        <DirectGenerateModal
          templates={templatesQuery.data?.data || []}
          onClose={() => setGenerateModalOpen(false)}
          onPreview={(tplId) => previewTplMut.mutateAsync({ id: tplId, employeeId })}
          onGenerate={async (templateId, title, confidential) => {
            try {
              await generateDocMut.mutateAsync({ templateId, employeeId, title, confidential });
              notify('success', 'Document generated successfully');
              setGenerateModalOpen(false);
            } catch (err: unknown) {
              notify('error', err instanceof Error ? err.message : 'Generation failed');
            }
          }}
          isGenerating={generateDocMut.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Modals for Employee 360
// ---------------------------------------------------------------------------

function DirectUploadModal({
  employeeId,
  onClose,
  onUpload,
  isSubmitting,
}: {
  employeeId: string;
  onClose: () => void;
  onUpload: (fd: FormData) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [category, setCategory] = useState<DocumentCategory>('Offer Letter');
  const [title, setTitle] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title.trim()) return;

    const fd = new FormData();
    fd.append('file', file);
    fd.append('employeeId', employeeId);
    fd.append('category', category);
    fd.append('title', title.trim());
    if (expiryDate) fd.append('expiryDate', expiryDate);
    fd.append('confidential', String(confidential));

    void onUpload(fd);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Upload Document</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Document Title *</label>
            <input
              required
              type="text"
              placeholder="e.g. Identity Proof / PAN"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Expiry Date</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">File *</label>
            <input
              required
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-slate-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dir-conf"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="rounded border-slate-300 text-brand-600"
            />
            <label htmlFor="dir-conf" className="text-xs text-slate-700">
              Confidential (HR Only)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DirectVersionModal({
  doc,
  onClose,
  onUpload,
  isSubmitting,
}: {
  doc: DocumentItem;
  onClose: () => void;
  onUpload: (fd: FormData) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    void onUpload(fd);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Upload Version v{doc.version + 1}</h3>
        <p className="text-xs text-slate-500">For {doc.title}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            required
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-500"
          />
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Uploading…' : 'Upload Version'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DirectHistoryModal({
  documentId,
  onClose,
  onDownload,
}: {
  documentId: string;
  onClose: () => void;
  onDownload: (doc: DocumentItem) => void;
}) {
  const historyQuery = useDocumentHistory(documentId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Version History</h3>
        {historyQuery.isLoading ? (
          <LoadingState label="Loading…" />
        ) : (
          <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {historyQuery.data?.data.map((item) => (
              <div key={item.id} className="py-2.5 flex justify-between items-center text-xs">
                <div>
                  <span className="font-semibold text-slate-900 mr-2">v{item.version}</span>
                  <span className="text-slate-600">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onDownload(item)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DirectGenerateModal({
  templates,
  onClose,
  onPreview,
  onGenerate,
  isGenerating,
}: {
  templates: DocumentTemplateItem[];
  onClose: () => void;
  onPreview: (templateId: string) => Promise<{ data: { renderedHtml: string } }>;
  onGenerate: (templateId: string, title?: string, confidential?: boolean) => Promise<void>;
  isGenerating: boolean;
}) {
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handlePreview = async () => {
    if (!templateId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await onPreview(templateId);
      setPreviewHtml(res.data.renderedHtml);
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed');
      setPreviewHtml(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) return;
    void onGenerate(templateId, title || undefined, confidential);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Generate Document (PDF)</h3>
        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Template *</label>
            <select
              required
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setPreviewHtml(null);
              }}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            >
              <option value="">Select template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.category})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Title (optional)</label>
            <input
              type="text"
              placeholder="Custom title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>

          <div className="flex justify-between items-center">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={confidential}
                onChange={(e) => setConfidential(e.target.checked)}
                className="rounded border-slate-300 text-brand-600"
              />
              Confidential (HR Only)
            </label>

            <button
              type="button"
              disabled={!templateId || previewLoading}
              onClick={() => void handlePreview()}
              className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewLoading ? 'Previewing…' : '👁 Preview'}
            </button>
          </div>

          {previewError && (
            <div className="rounded bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              {previewError}
            </div>
          )}

          {previewHtml && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 max-h-48 overflow-y-auto">
              <div
                className="prose prose-xs bg-white p-3 rounded border border-slate-200"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating || !templateId}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {isGenerating ? 'Generating…' : 'Generate PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
