import { useParams } from 'react-router-dom';
import { useEmployee } from './api';
import { EmployeeForm } from './EmployeeForm';
import { ErrorState, LoadingState } from '../../components/ui';

export function EmployeeEditPage() {
  const { id } = useParams<{ id: string }>();
  const detailQuery = useEmployee(id);

  if (detailQuery.isPending) return <LoadingState label="Loading employee…" />;
  if (detailQuery.isError) {
    return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  }

  return <EmployeeForm initial={detailQuery.data.data} />;
}
