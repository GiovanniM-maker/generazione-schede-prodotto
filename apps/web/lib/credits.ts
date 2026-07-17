import { getServiceClient } from '@/lib/supabase/service';

// Saldo crediti corrente (somma del ledger, via funzione SQL).
export async function getCreditBalance(organizationId: string): Promise<number> {
  const service = getServiceClient();
  const { data, error } = await service.rpc('get_credit_balance', { org: organizationId });
  if (error) return 0;
  return Number(data ?? 0);
}
