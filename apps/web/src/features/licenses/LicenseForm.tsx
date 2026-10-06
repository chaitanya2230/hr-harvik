import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { LicenseItem } from '../../api/types';
import { useCreateLicense, useUpdateLicense } from './api';
import { useToast } from '../../components/Toast';
import { Card, ErrorState, PageHeader } from '../../components/ui';

/** AGENTS.md §9 — license create/edit form; the key field is input-only. */

const licenseFormSchema = z.object({
  softwareName: z.string().trim().min(1, 'Software name is required').max(120),
  licenseType: z.string().trim().min(1, 'License type is required').max(60),
  licenseKey: z.string().trim().max(2000).optional().or(z.literal('')),
  provider: z.string().trim().max(120).optional().or(z.literal('')),
  maxSeats: z.coerce.number().int().min(1, 'At least 1 seat'),
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  renewalDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
});

type LicenseFormValues = z.infer<typeof licenseFormSchema>;

const fieldClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500';
const labelClass = 'block text-sm font-medium text-slate-700';

export function LicenseForm({ initial }: { initial?: LicenseItem }) {
  const navigate = useNavigate();
  const notify = useToast();
  const isEdit = Boolean(initial);

  const createMutation = useCreateLicense();
  const updateMutation = useUpdateLicense(initial?.id ?? '');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LicenseFormValues>({
    resolver: zodResolver(licenseFormSchema),
    defaultValues: {
      softwareName: initial?.softwareName ?? '',
      licenseType: initial?.licenseType ?? 'Per-Seat',
      licenseKey: '',
      provider: initial?.provider ?? '',
      maxSeats: initial?.maxSeats ?? 1,
      startDate: initial?.startDate ?? '',
      renewalDate: initial?.renewalDate ?? '',
    },
  });

  const onSubmit = async (values: LicenseFormValues): Promise<void> => {
    const payload: Record<string, unknown> = {
      softwareName: values.softwareName.trim(),
      licenseType: values.licenseType.trim(),
      maxSeats: values.maxSeats,
    };
    if (values.licenseKey?.trim()) payload.licenseKey = values.licenseKey.trim();
    if (values.provider?.trim()) payload.provider = values.provider.trim();
    if (values.startDate?.trim()) payload.startDate = values.startDate.trim();
    if (values.renewalDate?.trim()) payload.renewalDate = values.renewalDate.trim();

    try {
      if (isEdit && initial) {
        await updateMutation.mutateAsync(payload);
        notify('success', 'License updated');
        navigate(`/licenses/${initial.id}`);
      } else {
        const created = await createMutation.mutateAsync(payload);
        notify('success', `License ${created.data.licenseCode} created`);
        navigate(`/licenses/${created.data.id}`);
      }
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Save failed. Please try again.');
    }
  };

  return (
    <div>
      <PageHeader title={isEdit ? 'Edit license' : 'Add license'} />
      {(createMutation.error ?? updateMutation.error) ? (
        <ErrorState error={createMutation.error ?? updateMutation.error} />
      ) : null}
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-6" noValidate>
        <Card title="License">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="softwareName" className={labelClass}>Software *</label>
              <input id="softwareName" {...register('softwareName')} className={fieldClass} />
              {errors.softwareName ? <p className="mt-1 text-xs text-red-600">{errors.softwareName.message}</p> : null}
            </div>
            <div>
              <label htmlFor="licenseType" className={labelClass}>License type *</label>
              <input id="licenseType" {...register('licenseType')} placeholder="Per-Seat, Site, …" className={fieldClass} />
              {errors.licenseType ? <p className="mt-1 text-xs text-red-600">{errors.licenseType.message}</p> : null}
            </div>
            <div>
              <label htmlFor="licenseKey" className={labelClass}>
                License key {isEdit ? '(leave blank to keep the stored key)' : '(optional)'}
              </label>
              <input id="licenseKey" type="password" autoComplete="off" {...register('licenseKey')} className={fieldClass} />
              <p className="mt-1 text-xs text-slate-500">Stored encrypted; never shown in lists.</p>
            </div>
            <div>
              <label htmlFor="provider" className={labelClass}>Provider</label>
              <input id="provider" {...register('provider')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="maxSeats" className={labelClass}>Maximum seats *</label>
              <input id="maxSeats" type="number" min={1} step={1} {...register('maxSeats')} className={fieldClass} />
              {errors.maxSeats ? <p className="mt-1 text-xs text-red-600">{errors.maxSeats.message}</p> : null}
            </div>
            <div>
              <label htmlFor="startDate" className={labelClass}>Start date</label>
              <input id="startDate" type="date" {...register('startDate')} className={fieldClass} />
              {errors.startDate ? <p className="mt-1 text-xs text-red-600">{errors.startDate.message}</p> : null}
            </div>
            <div>
              <label htmlFor="renewalDate" className={labelClass}>Renewal date</label>
              <input id="renewalDate" type="date" {...register('renewalDate')} className={fieldClass} />
              {errors.renewalDate ? <p className="mt-1 text-xs text-red-600">{errors.renewalDate.message}</p> : null}
            </div>
          </div>
        </Card>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting || createMutation.isPending || updateMutation.isPending
              ? 'Saving…'
              : isEdit
                ? 'Save changes'
                : 'Create license'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
