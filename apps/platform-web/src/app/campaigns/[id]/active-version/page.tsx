'use client';

import { useParams } from 'next/navigation';
import { ActiveVersion } from '../../../../components/ActiveVersion';
import { AppHeader } from '../../../../components/AppHeader';

/** F3(a): versión vigente administrativa de la campaña (no despliega contenido). */
export default function ActiveVersionPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <AppHeader />
      <ActiveVersion campaignId={params.id} />
    </>
  );
}
