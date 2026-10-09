'use client';

import { useParams } from 'next/navigation';
import { AppHeader } from '../../../components/AppHeader';
import { CampaignDetail } from '../../../components/CampaignDetail';

export default function CampaignPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <AppHeader />
      <CampaignDetail campaignId={params.id} />
    </>
  );
}
