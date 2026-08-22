'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { salvaDatiFatturazione, type DatiFatturazione } from '@/lib/actions/fatturazione';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avviso } from '@/components/ui/avviso';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { riassuntoErrori } from '@app/core/moduli';

// ---------------------------------------------------------------------------
// I dati con cui esce la fattura.
//
// Non sono il nome dell'organizzazione: «Cascina Verde» è come si chiamano,
// «Cascina Verde S.r.l.» è chi emette la fattura, e i due non coincidono quasi
// mai. Per questo il form ha un campo suo e non riusa `organizations.name`.
// ---------------------------------------------------------------------------

interface Props {
  iniziali: DatiFatturazione;
  isOwner: boolean;
}

export function DatiFatturazioneForm({ iniziali, isOwner }: Props) {
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);
  const [salvato, setSalvato] = useState(false);
  const [completi, setCompleti] = useState(iniziali.completi);
  /**
   * L'errore del campo colpevole, non della pagina.
   *
   * Prima il server rispondeva con una stringa sola e il modulo la mostrava
   * in cima: su dieci campi diceva «qualcosa non va» senza dire dove. Adesso
   * l'azione dice anche QUALE campo, e il messaggio va lì.
   */
  const [erroriCampo, setErroriCampo] = useState<Record<string, string>>({});
  const [v, setV] = useState({
    billingName: iniziali.billingName ?? '',
    vatNumber: iniziali.vatNumber ?? '',
    taxCode: iniziali.taxCode ?? '',
    sdiCode: iniziali.sdiCode ?? '',
    pecEmail: iniziali.pecEmail ?? '',
    address: iniziali.address ?? '',
    zip: iniziali.zip ?? '',
    city: iniziali.city ?? '',
    province: iniziali.province ?? '',
    country: iniziali.country || 'IT',
  });

  /** A quale controllo appartiene ogni valore: serve a posare l'errore. */
  const CAMPO: Partial<Record<keyof typeof v, string>> = {
    billingName: 'fat-nome',
    vatNumber: 'fat-piva',
    taxCode: 'fat-cf',
    sdiCode: 'fat-sdi',
    pecEmail: 'fat-pec',
    address: 'fat-indirizzo',
    zip: 'fat-cap',
    city: 'fat-citta',
  };

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV((p) => ({ ...p, [k]: e.target.value }));
    setSalvato(false);
    // L'errore sparisce mentre si rimedia. Senza, bisognerebbe reinviare il
    // modulo per sapere se il campo adesso va bene: si scrive alla cieca.
    const id = CAMPO[k];
    if (id && erroriCampo[id]) {
      setErroriCampo((p) => {
        const q = { ...p };
        delete q[id];
        return q;
      });
    }
  };

  function salva() {
    setErrore(null);
    setErroriCampo({});
    setSalvato(false);
    startTransition(async () => {
      const res = await salvaDatiFatturazione(v);
      if (!res.ok) {
        if (res.campo) {
          setErroriCampo({ [res.campo]: res.error });
          // Il fuoco va sul campo colpevole. È la parte che rende inutile
          // rileggere il modulo: si arriva dove serve senza cercare.
          requestAnimationFrame(() => {
            const el = document.getElementById(res.campo!);
            el?.focus();
            el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          });
        } else {
          setErrore(res.error);
        }
        return;
      }
      setCompleti(res.data.completi);
      setSalvato(true);
    });
  }

  // L'ordine è quello in cui i campi stanno nella pagina, non quello in cui il
  // validatore li ha trovati: chi preme il sommario si aspetta di finire in
  // cima al modulo, non a metà.
  const sommario = riassuntoErrori(erroriCampo, [
    { id: 'fat-nome', etichetta: 'Ragione sociale' },
    { id: 'fat-piva', etichetta: 'Partita IVA' },
    { id: 'fat-cf', etichetta: 'Codice fiscale' },
    { id: 'fat-sdi', etichetta: 'Codice destinatario' },
    { id: 'fat-pec', etichetta: 'PEC' },
    { id: 'fat-via', etichetta: 'Indirizzo' },
    { id: 'fat-cap', etichetta: 'CAP' },
    { id: 'fat-citta', etichetta: 'Città' },
  ]);

  return (
    <div id="dati-fattura">
      <h2 className="text-lg font-semibold text-ink-900">Dati per la fattura</h2>
      <p className="mt-1 text-sm text-ink-500">
        Servono per emettere la fattura elettronica. Vanno compilati prima del
        primo acquisto.
      </p>

      <Card className="mt-4 p-5">
        {/* Lo stato si dice prima del form: chi arriva qui vuole sapere se
            manca qualcosa, non scoprirlo al momento di pagare. */}
        {completi ? (
          <Avviso tono="riuscito" className="mb-4">
            Dati completi: la fattura può essere emessa.
          </Avviso>
        ) : (
          <Avviso tono="attenzione" className="mb-4">
            Mancano dei dati: senza, l’acquisto non può partire perché non
            sapremmo a chi intestare la fattura.
          </Avviso>
        )}

        {sommario.quanti > 0 && (
          <Avviso tono="errore" className="mb-4">
            <button
              type="button"
              className="text-left underline underline-offset-2"
              onClick={() => {
                const el = sommario.primo ? document.getElementById(sommario.primo) : null;
                el?.focus();
                el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }}
            >
              {sommario.titolo}
            </button>
          </Avviso>
        )}

        {!isOwner ? (
          <p className="text-sm text-ink-500">
            I dati di fatturazione li imposta il proprietario dell’organizzazione.
          </p>
        ) : (
          // Dieci campi: è il modulo più lungo del prodotto, ed era l'unico
          // posto dove dopo aver scritto la partita IVA bisognava andare col
          // mouse a cercare «Salva». Adesso Invio salva, e il gestore di
          // password riconosce l'indirizzo di fatturazione come tale.
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pending) salva();
            }}
          >
            <div>
              <Label htmlFor="fat-nome">Ragione sociale o nome e cognome</Label>
              <Input
                id="fat-nome"
                errore={erroriCampo['fat-nome']}
                value={v.billingName}
                onChange={set('billingName')}
                placeholder="Cascina Verde S.r.l."
                autoComplete="organization"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="fat-piva">Partita IVA</Label>
                <Input
                  id="fat-piva"
                errore={erroriCampo['fat-piva']}
                  value={v.vatNumber}
                  onChange={set('vatNumber')}
                  placeholder="12345678903"
                  inputMode="numeric"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Senza il prefisso IT. Se non ne hai una, lascia vuoto e
                  compila il codice fiscale.
                </p>
              </div>
              <div>
                <Label htmlFor="fat-cf">Codice fiscale</Label>
                <Input
                  id="fat-cf"
                errore={erroriCampo['fat-cf']}
                  value={v.taxCode}
                  onChange={set('taxCode')}
                  placeholder="RSSMRA80A01H501U"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Per i privati sostituisce la partita IVA.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="fat-sdi">Codice destinatario (SDI)</Label>
                <Input
                  id="fat-sdi"
                errore={erroriCampo['fat-sdi']}
                  value={v.sdiCode}
                  onChange={set('sdiCode')}
                  placeholder="0000000"
                  maxLength={7}
                />
                <p className="mt-1 text-xs text-ink-500">
                  7 caratteri. Se non ce l’hai scrivi 0000000 e indica la PEC.
                </p>
              </div>
              <div>
                <Label htmlFor="fat-pec">PEC</Label>
                <Input
                  id="fat-pec"
                errore={erroriCampo['fat-pec']}
                  type="email"
                  value={v.pecEmail}
                  onChange={set('pecEmail')}
                  placeholder="azienda@pec.it"
                />
                <p className="mt-1 text-xs text-ink-500">
                  In alternativa al codice destinatario.
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="fat-via">Indirizzo</Label>
              <Input
                id="fat-via"
                errore={erroriCampo['fat-via']}
                value={v.address}
                onChange={set('address')}
                placeholder="Via Roma 1"
                autoComplete="street-address"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="fat-cap">CAP</Label>
                <Input
                  id="fat-cap"
                errore={erroriCampo['fat-cap']}
                  value={v.zip}
                  onChange={set('zip')}
                  placeholder="20121"
                  inputMode="numeric"
                  autoComplete="postal-code"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="fat-citta">Città</Label>
                <Input
                  id="fat-citta"
                errore={erroriCampo['fat-citta']}
                  value={v.city}
                  onChange={set('city')}
                  placeholder="Milano"
                  autoComplete="address-level2"
                />
              </div>
              {/* Larga quanto «Paese»: due campi che accettano due caratteri
                  e si somigliano nel contenuto misuravano 254 px e 128 px, e
                  la differenza faceva sembrare che il primo volesse di più. */}
              <div className="sm:max-w-[8rem]">
                <Label htmlFor="fat-prov">Provincia</Label>
                <Input
                  id="fat-prov"
                  value={v.province}
                  onChange={set('province')}
                  placeholder="MI"
                  maxLength={2}
                />
              </div>
            </div>

            <div className="sm:max-w-[8rem]">
              <Label htmlFor="fat-paese">Paese</Label>
              <Input
                id="fat-paese"
                value={v.country}
                onChange={set('country')}
                placeholder="IT"
                maxLength={2}
                autoComplete="country"
              />
            </div>

            {errore && (
              <Avviso tono="errore">{errore}</Avviso>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Salva dati fattura
              </Button>
              {/* Un cambiamento che non si vede è indistinguibile da un
                  pulsante rotto. */}
              <span aria-live="polite" className="text-sm text-emerald-700">
                {salvato && !pending ? 'Salvato.' : ''}
              </span>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
