import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import {
  documentKeys,
  downloadDocument,
  useCreateDocumentTemplate,
  useDeleteDocument,
  useDeleteDocumentTemplate,
  useDocumentHistory,
  useDocuments,
  useDocumentTemplates,
  useGenerateDocument,
  usePdfGenerateJob,
  usePreviewTemplate,
  useUpdateDocumentTemplate,
  useUploadDocument,
  useUploadDocumentVersion,
} from './api';
import { useEmployeeList } from '../employees/api';
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

const EMPLOYMENT_TYPES = ['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other'];

export function DocumentListPage() {
  const { account } = useAuth();
  const notify = useToast();

  const isHr = account?.role === 'HR Admin' || account?.role === 'HR Manager';
  const isAdmin = account?.role === 'HR Admin';

  const [activeTab, setActiveTab] = useState<'documents' | 'templates'>('documents');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [search, setSearch] = useState('');

  // Modals state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [versionModalDoc, setVersionModalDoc] = useState<DocumentItem | null>(null);
  const [historyModalDocId, setHistoryModalDocId] = useState<string | null>(null);
  const [templateModalItem, setTemplateModalItem] = useState<DocumentTemplateItem | 'new' | null>(null);

  // Queries
  const docsQuery = useDocuments({
    page,
    limit: 20,
    category: categoryFilter || undefined,
    employeeId: employeeFilter || undefined,
    search: search || undefined,
  });

  const templatesQuery = useDocumentTemplates(undefined, activeTab === 'templates' || generateModalOpen);
  const employeesQuery = useEmployeeList(
    { page: 1, limit: 100 },
    uploadModalOpen || generateModalOpen || isHr,
  );

  // Mutations
  const uploadDocMut = useUploadDocument();
  const uploadVersionMut = useUploadDocumentVersion();
  const deleteDocMut = useDeleteDocument();
  const createTplMut = useCreateDocumentTemplate();
  const updateTplMut = useUpdateDocumentTemplate();
  const deleteTplMut = useDeleteDocumentTemplate();
  const previewTplMut = usePreviewTemplate();
  const generateDocMut = useGenerateDocument();

  // §3 — queued PDF generation: poll the job started from the Generate modal.
  const [pdfJobId, setPdfJobId] = useState<string | null>(null);
  const pdfJobQuery = usePdfGenerateJob(pdfJobId);
  const queryClient = useQueryClient();

  useEffect(() => {
    const status = pdfJobQuery.data?.status;
    if (!pdfJobId || !status) return;
    if (status === 'completed') {
      notify('success', 'Queued PDF generated and saved to Documents');
      setPdfJobId(null);
      void queryClient.invalidateQueries({ queryKey: documentKeys.all });
    } else if (status === 'failed') {
      notify('error', pdfJobQuery.data?.error || 'Queued PDF generation failed');
      setPdfJobId(null);
    }
  }, [pdfJobQuery.data, pdfJobId, notify, queryClient]);

  // Handlers
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
      notify('success', 'Document deleted successfully');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete document');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents & Templates"
        subtitle="Manage employee records, agreements, offer letters, and PDF generation"
        actions={
          <div className="flex gap-2">
            {isHr && (
              <>
                <button
                  type="button"
                  onClick={() => setGenerateModalOpen(true)}
                  className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-500"
                >
                  Generate Document
                </button>
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(true)}
                  className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Upload Document
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-6">
          <button
            type="button"
            onClick={() => setActiveTab('documents')}
            className={`border-b-2 py-3 text-sm font-medium ${
              activeTab === 'documents'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            All Documents
          </button>
          {isHr && (
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className={`border-b-2 py-3 text-sm font-medium ${
                activeTab === 'templates'
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              Document Templates
            </button>
          )}
        </nav>
      </div>

      {/* TAB 1: DOCUMENTS */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-white p-4 shadow-sm border border-slate-200">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="Search document title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="">All Categories</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {isHr && (
                <>
                  <label htmlFor="doc-employee-filter" className="sr-only">
                    Filter by employee
                  </label>
                  <select
                    id="doc-employee-filter"
                    value={employeeFilter}
                    onChange={(e) => {
                      setEmployeeFilter(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">All employees</option>
                    {employeesQuery.data?.data.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.employeeCode})
                      </option>
                    ))}
                  </select>
                </>
              )}
              {(search || categoryFilter || employeeFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setCategoryFilter('');
                    setEmployeeFilter('');
                    setPage(1);
                  }}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Total: {docsQuery.data?.meta.total ?? 0} documents
            </p>
          </div>

          {/* §3 — background (queued) generation progress */}
          {pdfJobId ? (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800"
            >
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-600" />
              Generating PDF in the background — it will appear in the list automatically.
            </div>
          ) : null}

          {docsQuery.isLoading ? (
            <LoadingState label="Loading documents…" />
          ) : docsQuery.isError ? (
            <ErrorState error={docsQuery.error} onRetry={() => void docsQuery.refetch()} />
          ) : docsQuery.data?.data.length === 0 ? (
            <EmptyState
              title="No documents found"
              hint={
                search || categoryFilter || employeeFilter
                  ? 'Try clearing your filters.'
                  : 'Upload or generate a document to get started.'
              }
            />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Title & Category</th>
                      <th className="px-4 py-3">Version</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Access</th>
                      <th className="px-4 py-3">Expiry Date</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docsQuery.data?.data.map((doc) => (
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
                              Confidential (HR Only)
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">Standard</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {doc.expiryDate || '—'}
                        </td>
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
              {docsQuery.data?.meta && docsQuery.data.meta.total > docsQuery.data.meta.limit && (
                <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
                  <p className="text-xs text-slate-500">
                    Showing page {page} of {Math.ceil(docsQuery.data.meta.total / docsQuery.data.meta.limit)} ({docsQuery.data.meta.total} documents)
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= Math.ceil(docsQuery.data.meta.total / docsQuery.data.meta.limit)}
                      onClick={() => setPage((p) => p + 1)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* TAB 2: TEMPLATES */}
      {activeTab === 'templates' && isHr && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-slate-200">
            <div>
              <h3 className="font-semibold text-slate-900">Standard Document Templates</h3>
              <p className="text-xs text-slate-500">
                Templates compile with Handlebars tokens: {'{{employee.firstName}}'}, {'{{employee.designation}}'}, {'{{company.name}}'}, etc.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setTemplateModalItem('new')}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500"
              >
                + Create Template
              </button>
            )}
          </div>

          {templatesQuery.isLoading ? (
            <LoadingState label="Loading templates…" />
          ) : templatesQuery.data?.data.length === 0 ? (
            <EmptyState title="No templates defined" hint="Create a template or seed data." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {templatesQuery.data?.data.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-3"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold text-slate-900">{tpl.name}</h4>
                      <p className="text-xs text-slate-500">{tpl.category}</p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        tpl.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tpl.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-slate-600">Applicable Types:</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {tpl.applicableEmploymentTypes.map((t) => (
                        <span key={t} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setGenerateModalOpen(true);
                      }}
                      className="text-xs font-medium text-brand-600 hover:text-brand-800"
                    >
                      Generate With This
                    </button>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => setTemplateModalItem(tpl)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
                            try {
                              await deleteTplMut.mutateAsync(tpl.id);
                              notify('success', 'Template deleted');
                            } catch (e: unknown) {
                              notify('error', e instanceof Error ? e.message : 'Delete failed');
                            }
                          }}
                          className="text-xs font-medium text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: UPLOAD DOCUMENT */}
      {uploadModalOpen && (
        <UploadModal
          onClose={() => setUploadModalOpen(false)}
          employees={employeesQuery.data?.data || []}
          onUpload={async (formData) => {
            try {
              await uploadDocMut.mutateAsync(formData);
              notify('success', 'Document uploaded successfully');
              setUploadModalOpen(false);
            } catch (err: unknown) {
              notify('error', err instanceof Error ? err.message : 'Upload failed');
            }
          }}
          isSubmitting={uploadDocMut.isPending}
        />
      )}

      {/* MODAL 2: UPLOAD VERSION */}
      {versionModalDoc && (
        <VersionModal
          doc={versionModalDoc}
          onClose={() => setVersionModalDoc(null)}
          onUpload={async (formData) => {
            try {
              await uploadVersionMut.mutateAsync({ id: versionModalDoc.id, formData });
              notify('success', 'New version uploaded successfully');
              setVersionModalDoc(null);
            } catch (err: unknown) {
              notify('error', err instanceof Error ? err.message : 'Version upload failed');
            }
          }}
          isSubmitting={uploadVersionMut.isPending}
        />
      )}

      {/* MODAL 3: VERSION HISTORY */}
      {historyModalDocId && (
        <HistoryModal
          documentId={historyModalDocId}
          onClose={() => setHistoryModalDocId(null)}
          onDownload={handleDownload}
        />
      )}

      {/* MODAL 4: GENERATE DOCUMENT */}
      {generateModalOpen && (
        <GenerateModal
          onClose={() => setGenerateModalOpen(false)}
          templates={templatesQuery.data?.data || []}
          employees={employeesQuery.data?.data || []}
          onPreview={(id, employeeId) => previewTplMut.mutateAsync({ id, employeeId })}
          onGenerate={async (templateId, employeeId, title, confidential, queued) => {
            try {
              const result = await generateDocMut.mutateAsync({
                templateId,
                employeeId,
                title,
                confidential,
                ...(queued ? { mode: 'queued' as const } : {}),
              });
              if (result.queued) {
                setPdfJobId(result.queued.jobId);
                notify('success', 'PDF generation queued — you will be notified when it finishes');
              } else {
                notify('success', 'Document generated successfully');
              }
              setGenerateModalOpen(false);
            } catch (err: unknown) {
              notify('error', err instanceof Error ? err.message : 'Generation failed');
            }
          }}
          isGenerating={generateDocMut.isPending}
        />
      )}

      {/* MODAL 5: TEMPLATE CREATE / EDIT */}
      {templateModalItem && (
        <TemplateModal
          template={templateModalItem === 'new' ? null : templateModalItem}
          onClose={() => setTemplateModalItem(null)}
          onSave={async (data) => {
            try {
              if (templateModalItem === 'new') {
                await createTplMut.mutateAsync(data);
                notify('success', 'Template created');
              } else {
                await updateTplMut.mutateAsync({ id: templateModalItem.id, payload: data });
                notify('success', 'Template updated');
              }
              setTemplateModalItem(null);
            } catch (err: unknown) {
              notify('error', err instanceof Error ? err.message : 'Save failed');
            }
          }}
          isSaving={createTplMut.isPending || updateTplMut.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload Modal Component
// ---------------------------------------------------------------------------

function UploadModal({
  onClose,
  employees,
  onUpload,
  isSubmitting,
}: {
  onClose: () => void;
  employees: Array<{ id: string; fullName: string; employeeCode: string; employmentType: string; status: string }>;
  onUpload: (data: FormData) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('Offer Letter');
  const [title, setTitle] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !employeeId || !title.trim()) return;

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
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Upload Employee Document</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Employee *</label>
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            >
              <option value="">Select Employee</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Document Title *</label>
            <input
              required
              type="text"
              placeholder="e.g. Master Employment Agreement"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Expiry Date (optional)</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">File * (PDF, Word, Images max 10MB)</label>
            <input
              required
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="confidential-check"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="rounded border-slate-300 text-brand-600"
            />
            <label htmlFor="confidential-check" className="text-xs text-slate-700">
              Confidential document (accessible to HR Admin and HR Manager only)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Uploading…' : 'Upload Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version Upload Modal Component
// ---------------------------------------------------------------------------

function VersionModal({
  doc,
  onClose,
  onUpload,
  isSubmitting,
}: {
  doc: DocumentItem;
  onClose: () => void;
  onUpload: (data: FormData) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [title, setTitle] = useState(doc.title);
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title.trim());

    void onUpload(fd);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Upload New Version (v{doc.version + 1})</h3>
        <p className="text-xs text-slate-500">
          This will archive v{doc.version} and create an unbroken version audit chain.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Document Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">New File *</label>
            <input
              required
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Uploading…' : 'Upload Version'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version History Modal
// ---------------------------------------------------------------------------

function HistoryModal({
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
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-slate-900">Version History</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {historyQuery.isLoading ? (
          <LoadingState label="Loading history…" />
        ) : historyQuery.data?.data.length === 0 ? (
          <EmptyState title="No history found" />
        ) : (
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {historyQuery.data?.data.map((item) => (
              <div key={item.id} className="py-3 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">v{item.version}</span>
                    <span className="text-sm text-slate-700">{item.title}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Uploaded on {new Date(item.createdAt).toLocaleString()} · {item.file.originalName} (
                    {Math.round(item.file.size / 1024)} KB)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDownload(item)}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate Document Modal Component
// ---------------------------------------------------------------------------

function GenerateModal({
  onClose,
  templates,
  employees,
  onPreview,
  onGenerate,
  isGenerating,
}: {
  onClose: () => void;
  templates: DocumentTemplateItem[];
  employees: Array<{ id: string; fullName: string; employeeCode: string; employmentType: string; status: string }>;
  onPreview: (templateId: string, employeeId: string) => Promise<{ data: { renderedHtml: string } }>;
  onGenerate: (
    templateId: string,
    employeeId: string,
    title?: string,
    confidential?: boolean,
    queued?: boolean,
  ) => Promise<void>;
  isGenerating: boolean;
}) {
  const [templateId, setTemplateId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [queuedMode, setQueuedMode] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const selectedEmployee = employees.find((e) => e.id === employeeId);

  const handlePreview = async () => {
    if (!templateId || !employeeId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await onPreview(templateId, employeeId);
      setPreviewHtml(res.data.renderedHtml);
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Preview generation failed');
      setPreviewHtml(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId || !employeeId) return;
    void onGenerate(templateId, employeeId, customTitle || undefined, confidential, queuedMode);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Generate Official Document (PDF)</h3>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Select Template *</label>
              <select
                required
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setPreviewHtml(null);
                }}
                className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
              >
                <option value="">Choose a template…</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.category})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Target Employee *</label>
              <select
                required
                value={employeeId}
                onChange={(e) => {
                  setEmployeeId(e.target.value);
                  setPreviewHtml(null);
                }}
                className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
              >
                <option value="">Choose an employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} ({emp.employmentType}) - {emp.status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Custom Title (optional)</label>
            <input
              type="text"
              placeholder={selectedTemplate && selectedEmployee ? `${selectedTemplate.name} - ${selectedEmployee.fullName}` : 'Auto-generated title'}
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="gen-confidential"
                  checked={confidential}
                  onChange={(e) => setConfidential(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600"
                />
                <label htmlFor="gen-confidential" className="text-xs text-slate-700">
                  Mark as confidential
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="gen-queued"
                  checked={queuedMode}
                  onChange={(e) => setQueuedMode(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600"
                />
                <label
                  htmlFor="gen-queued"
                  className="text-xs text-slate-700"
                  title="Run generation on the background queue (§3 — BullMQ); the document appears when it finishes"
                >
                  Run in background
                </label>
              </div>
            </div>

            <button
              type="button"
              disabled={!templateId || !employeeId || previewLoading}
              onClick={() => void handlePreview()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewLoading ? 'Generating Preview…' : '👁 Preview Document'}
            </button>
          </div>

          {previewError && (
            <div className="rounded-md bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              {previewError}
            </div>
          )}

          {previewHtml && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 max-h-60 overflow-y-auto">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Live Document Preview:
              </p>
              <div
                className="prose prose-sm max-w-none bg-white p-4 rounded border border-slate-200"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating || !templateId || !employeeId}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {isGenerating ? 'Generating PDF…' : 'Generate & Persist PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Create / Edit Modal
// ---------------------------------------------------------------------------

function TemplateModal({
  template,
  onClose,
  onSave,
  isSaving,
}: {
  template: DocumentTemplateItem | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    category: DocumentCategory;
    applicableEmploymentTypes: string[];
    bodyHtml: string;
  }) => Promise<void>;
  isSaving: boolean;
}) {
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState<DocumentCategory>(template?.category || 'Offer Letter');
  const [applicableTypes, setApplicableTypes] = useState<string[]>(
    template?.applicableEmploymentTypes || ['Full-Time'],
  );
  const [bodyHtml, setBodyHtml] = useState(
    template?.bodyHtml ||
      `<h2>OFFER LETTER</h2>\n<p>Dear {{employee.firstName}} {{employee.lastName}},</p>\n<p>We are pleased to offer you the position of {{employee.designation}} at {{company.name}} starting {{employee.dateOfJoining}}.</p>`,
  );

  const toggleType = (t: string) => {
    setApplicableTypes((prev) =>
      prev.includes(t) ? prev.filter((item) => item !== t) : [...prev, t],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || applicableTypes.length === 0 || !bodyHtml.trim()) return;

    void onSave({
      name: name.trim(),
      category,
      applicableEmploymentTypes: applicableTypes,
      bodyHtml,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">
          {template ? 'Edit Document Template' : 'Create New Document Template'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Template Name *</label>
              <input
                required
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Category *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Applicable Employment Types *
            </label>
            <div className="flex flex-wrap gap-2">
              {EMPLOYMENT_TYPES.map((t) => (
                <label key={t} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={applicableTypes.includes(t)}
                    onChange={() => toggleType(t)}
                    className="rounded border-slate-300 text-brand-600"
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-medium text-slate-700">Template HTML Body *</label>
              <span className="text-[11px] text-slate-400">Handlebars supported</span>
            </div>
            <textarea
              required
              rows={8}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              className="block w-full font-mono text-xs rounded-md border border-slate-300 p-2"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Tokens: {'{{employee.firstName}}'}, {'{{employee.lastName}}'}, {'{{employee.fullName}}'}, {'{{employee.designation}}'}, {'{{employee.dateOfJoining}}'}, {'{{company.name}}'}, {'{{today}}'}, {'{{exit.lastWorkingDay}}'}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
