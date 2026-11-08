import { OG_SIZE } from '@/app/_og/card';
import { pickCard } from '@/app/_og/pick-card';

export const alt = 'A prediction on 0xkafka';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  return pickCard((await params).id);
}
