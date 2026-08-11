'use server';

import { partitaIvaValida, codiceSdiValido, writeOrThrow } from '@app/core';
import { getSessionUser, getUserOrg } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';
import { soloProprietario } from '@/lib/ownership';
import { datiFatturaCompleti } from '@/lib/fattura';

// ---------------------------------------------------------------------------
// I dati per la fattura.
//
// Senza partita IVA e codice destinatario nessun cliente B2B italiano può
// comprare: la fattura elettronica non è un optional, è come funziona la
// fatturazione in Italia. Nel repository non ce n'era traccia — nessun campo,
// nessun controllo, nessuna schermata.
//
// Sono separati dal nome dell'organizzazione: «Cascina Verde» è come si
// chiamano, «Cascina Verde S.r.l.» è chi emette la fattura, e i due non
// coincidono quasi mai.
// ---------------------------------------------------------------------------

export interface DatiFatturazione {
  billingName: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  sdiCode: string | null;
  pecEmail: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  province: string | null;
  country: string;
  /** Vero se c'è abbastanza per emettere una fattura. */
  completi: boolean;
}

type Esito<T> = { ok: true; data: T } | { ok: false; error: string };

export async function leggiDatiFatturazione(): Promise<Esito<DatiFatturazione>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Non autenticato' };
  const org = await getUserOrg(user.id);
  if (!org) return { ok: false, error: 'Nessuna organizzazione' };

  const service = getServiceClient();
  const { data } = await service
    .from('organizations')
    .select(
      'billing_name, vat_number, tax_code, sdi_code, pec_email, billing_address, billing_zip, billing_city, billing_province, billing_country',
    )
    .eq('id', org.organizationId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'Organizzazione non trovata' };

  return {
    ok: true,
    data: {
      billingName: data.billing_name,
      vatNumber: data.vat_number,
      taxCode: data.tax_code,
      sdiCode: data.sdi_code,
      pecEmail: data.pec_email,
      address: data.billing_address,
      zip: data.billing_zip,
      city: data.billing_city,
      province: data.billing_province,
      country: data.billing_country ?? 'IT',
      completi: datiFatturaCompleti(data),
    },
  };
}

export async function salvaDatiFatturazione(input: {
  billingName: string;
  vatNumber?: string;
  taxCode?: string;
  sdiCode?: string;
  pecEmail?: string;
  address: string;
  zip: string;
  city: string;
  province?: string;
  country?: string;
}): Promise<Esito<{ completi: boolean }>> {
  // Sono i dati con cui si emette una fattura a nome dell'azienda: li mette
  // chi dell'azienda risponde.
  const permesso = await soloProprietario('modificare i dati di fatturazione');
  if (!permesso.ok) return { ok: false, error: permesso.error };

  const pulisci = (v?: string) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };
  const billingName = pulisci(input.billingName);
  const vatNumber = pulisci(input.vatNumber)?.replace(/\s/g, '').replace(/^IT/i, '') ?? null;
  const taxCode = pulisci(input.taxCode)?.toUpperCase() ?? null;
  const sdiCode = pulisci(input.sdiCode)?.toUpperCase() ?? null;
  const pecEmail = pulisci(input.pecEmail);
  const address = pulisci(input.address);
  const zip = pulisci(input.zip);
  const city = pulisci(input.city);
  const country = (pulisci(input.country) ?? 'IT').toUpperCase();

  if (!billingName) return { ok: false, error: 'La ragione sociale è obbligatoria.' };
  if (!address || !zip || !city) {
    return { ok: false, error: 'Indirizzo, CAP e città sono obbligatori per la fattura.' };
  }
  if (!vatNumber && !taxCode) {
    return { ok: false, error: 'Serve la partita IVA o, per i privati, il codice fiscale.' };
  }
  // Il controllo sulla partita IVA vale per l'Italia: fuori le regole sono
  // altre, e rifiutare una VAT estera valida sarebbe peggio che non
  // controllarla.
  if (vatNumber && country === 'IT' && !partitaIvaValida(vatNumber)) {
    return { ok: false, error: 'La partita IVA non è valida: controlla le 11 cifre.' };
  }
  if (country === 'IT' && !sdiCode && !pecEmail) {
    return {
      ok: false,
      error:
        'Per la fattura elettronica serve il codice destinatario SDI oppure una PEC. Se non hai un codice, scrivi 0000000 e indica la PEC.',
    };
  }
  if (sdiCode && !codiceSdiValido(sdiCode)) {
    return { ok: false, error: 'Il codice destinatario è di 7 caratteri (es. 0000000).' };
  }

  const service = getServiceClient();
  try {
    await writeOrThrow(
      'organizations.update(fatturazione)',
      service
        .from('organizations')
        .update({
          billing_name: billingName,
          vat_number: vatNumber,
          tax_code: taxCode,
          sdi_code: sdiCode,
          pec_email: pecEmail,
          billing_address: address,
          billing_zip: zip,
          billing_city: city,
          billing_province: pulisci(input.province),
          billing_country: country,
        })
        .eq('id', permesso.organizationId),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Salvataggio non riuscito' };
  }

  return {
    ok: true,
    data: {
      completi: datiFatturaCompleti({
        billing_name: billingName,
        vat_number: vatNumber,
        tax_code: taxCode,
        sdi_code: sdiCode,
        pec_email: pecEmail,
        billing_address: address,
        billing_zip: zip,
        billing_city: city,
        billing_country: country,
      }),
    },
  };
}
