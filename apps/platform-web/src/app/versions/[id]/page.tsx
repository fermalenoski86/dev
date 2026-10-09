'use client';

import { useParams } from 'next/navigation';
import { AppHeader } from '../../../components/AppHeader';
import { VersionReview } from '../../../components/VersionReview';

export default function VersionPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <AppHeader />
      <VersionReview versionId={params.id} />
    </>
  );
}
