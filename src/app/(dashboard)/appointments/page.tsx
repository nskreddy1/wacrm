import type { Metadata } from 'next';

import { AppointmentWorkspace } from '@/features/appointments/components/appointment-workspace';

export const metadata: Metadata = {
  title: 'Appointments | WhatsApp CRM',
  description:
    'Schedule and manage appointments linked to contacts and your services catalog.',
};

export default function AppointmentsPage() {
  return <AppointmentWorkspace />;
}
