import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { AssetItem } from '../../api/types';
import { useCreateAsset, useUpdateAsset } from './api';
import { useToast } from '../../components/Toast';
import { Card, ErrorState, PageHeader } from '../../components/ui';

/**
 * AGENTS.md §9 — asset create/edit form. Zod mirrors the backend schemas;
 * `type` is free text so new asset types need no frontend change either.
 */

const assetFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: z.string().trim().min(1, 'Type is required').max(60),
  brand: z.string().trim().max(120).optional().or(z.literal('')),
  model: z.string().trim().max(120).optional().or(z.literal('')),
  serialNumber: z.string().trim().min(1, 'Serial number is required').max(120),
  purchaseDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  purchaseCost: z.coerce.number().min(0, 'Cost cannot be negative').optional(),
  condition: z.string().trim().max(60).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

type AssetFormValues = z.infer<typeof assetFormSchema>;

const fieldClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500';
const labelClass = 'block text-sm font-medium text-slate-700';

export function AssetForm({ initial }: { initial?: AssetItem }) {
  const navigate = useNavigate();
  const notify = useToast();
  const isEdit = Boolean(initial);

  const createMutation = useCreateAsset();
  const updateMutation = useUpdateAsset(initial?.id ?? '');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      name: initial?.name ?? '',
      type: initial?.type ?? '',
      brand: initial?.brand ?? '',
      model: initial?.model ?? '',
      serialNumber: initial?.serialNumber ?? '',
      purchaseDate: initial?.purchaseDate ?? '',
      purchaseCost: initial?.purchaseCost ?? undefined,
      condition: initial?.condition ?? '',
      notes: initial?.notes ?? '',
    },
  });

  const onSubmit = async (values: AssetFormValues): Promise<void> => {
    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      type: values.type.trim(),
      serialNumber: values.serialNumber.trim(),
    };
    if (values.brand?.trim()) payload.brand = values.brand.trim();
    if (values.model?.trim()) payload.model = values.model.trim();
    if (values.purchaseDate?.trim()) payload.purchaseDate = values.purchaseDate.trim();
    if (values.purchaseCost !== undefined) payload.purchaseCost = values.purchaseCost;
    if (values.condition?.trim()) payload.condition = values.condition.trim();
    if (values.notes?.trim()) payload.notes = values.notes.trim();

    try {
      if (isEdit && initial) {
        await updateMutation.mutateAsync(payload);
        notify('success', 'Asset updated');
        navigate(`/assets/${initial.id}`);
      } else {
        const created = await createMutation.mutateAsync(payload);
        notify('success', `Asset ${created.data.assetCode} created`);
        navigate(`/assets/${created.data.id}`);
      }
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Save failed. Please try again.');
    }
  };

  return (
    <div>
      <PageHeader title={isEdit ? 'Edit asset' : 'Add asset'} />
      {(createMutation.error ?? updateMutation.error) ? (
        <ErrorState error={createMutation.error ?? updateMutation.error} />
      ) : null}
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-6" noValidate>
        <Card title="Asset">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className={labelClass}>Name *</label>
              <input id="name" {...register('name')} className={fieldClass} />
              {errors.name ? <p className="mt-1 text-xs text-red-600">{errors.name.message}</p> : null}
            </div>
            <div>
              <label htmlFor="type" className={labelClass}>Type *</label>
              <input id="type" {...register('type')} placeholder="Laptop, Monitor, …" className={fieldClass} />
              {errors.type ? <p className="mt-1 text-xs text-red-600">{errors.type.message}</p> : null}
            </div>
            <div>
              <label htmlFor="brand" className={labelClass}>Brand</label>
              <input id="brand" {...register('brand')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="model" className={labelClass}>Model</label>
              <input id="model" {...register('model')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="serialNumber" className={labelClass}>Serial number *</label>
              <input id="serialNumber" {...register('serialNumber')} className={fieldClass} />
              {errors.serialNumber ? <p className="mt-1 text-xs text-red-600">{errors.serialNumber.message}</p> : null}
            </div>
            <div>
              <label htmlFor="condition" className={labelClass}>Condition</label>
              <input id="condition" {...register('condition')} placeholder="New, Good, Fair…" className={fieldClass} />
            </div>
            <div>
              <label htmlFor="purchaseDate" className={labelClass}>Purchase date</label>
              <input id="purchaseDate" type="date" {...register('purchaseDate')} className={fieldClass} />
              {errors.purchaseDate ? <p className="mt-1 text-xs text-red-600">{errors.purchaseDate.message}</p> : null}
            </div>
            <div>
              <label htmlFor="purchaseCost" className={labelClass}>Purchase cost</label>
              <input id="purchaseCost" type="number" min={0} step="any" {...register('purchaseCost')} className={fieldClass} />
              {errors.purchaseCost ? <p className="mt-1 text-xs text-red-600">{errors.purchaseCost.message}</p> : null}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="notes" className={labelClass}>Notes</label>
              <textarea id="notes" {...register('notes')} rows={3} className={fieldClass} />
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
                : 'Create asset'}
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
