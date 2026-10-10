'use client';

import { useParams } from 'next/navigation';
import { AppHeader } from '../../../../components/AppHeader';
import { CampaignVersions } from '../../../../components/CampaignVersions';

/** BL-31: historial de versiones de la campaña. */
export default function CampaignVersionsPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <AppHeader />
      <CampaignVersions campaignId={params.id} />
    </>
  );
}
