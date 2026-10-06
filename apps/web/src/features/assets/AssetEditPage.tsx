import { useParams } from 'react-router-dom';
import { useAsset } from './api';
import { AssetForm } from './AssetForm';
import { ErrorState, LoadingState } from '../../components/ui';

export function AssetEditPage() {
  const { id } = useParams<{ id: string }>();
  const detailQuery = useAsset(id);

  if (detailQuery.isPending) return <LoadingState label="Loading asset…" />;
  if (detailQuery.isError) {
    return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  }

  return <AssetForm initial={detailQuery.data.data} />;
}
