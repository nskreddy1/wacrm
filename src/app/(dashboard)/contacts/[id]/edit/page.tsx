import { redirect } from 'next/navigation';

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/contacts?contact=${encodeURIComponent(id)}`);
}
