import { useParams } from 'react-router-dom';
import { useLicense } from './api';
import { LicenseForm } from './LicenseForm';
import { ErrorState, LoadingState } from '../../components/ui';

export function LicenseEditPage() {
  const { id } = useParams<{ id: string }>();
  const detailQuery = useLicense(id);

  if (detailQuery.isPending) return <LoadingState label="Loading license…" />;
  if (detailQuery.isError) {
    return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  }

  return <LicenseForm initial={detailQuery.data.data} />;
}
