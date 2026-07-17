import { requireUser } from '@/lib/auth';
import { OnboardingStepper } from '@/components/onboarding-stepper';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Benvenuto</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configura il profilo del tuo brand in pochi passaggi.
        </p>
      </div>
      <OnboardingStepper />
    </div>
  );
}
