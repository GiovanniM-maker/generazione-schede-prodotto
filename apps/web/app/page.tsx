import Link from 'next/link';
import {
  ArrowRight,
  UploadCloud,
  ListChecks,
  ShieldCheck,
  Eye,
  Sparkles,
  FileSpreadsheet,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formattaPrezzo, prezzoPerCredito } from '@app/core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const steps = [
  { icon: UploadCloud, title: 'Carica', text: 'Importa il catalogo in CSV o Excel.' },
  { icon: ListChecks, title: 'Mappa', text: 'Abbina le colonne ai campi del tuo settore.' },
  { icon: Eye, title: 'Controlla', text: 'Verifica i dati prima di procedere.' },
  { icon: Sparkles, title: 'Campione', text: 'Approva un campione nel tuo tono.' },
  { icon: Layers, title: 'Genera', text: 'Elabora l’intero catalogo in massa.' },
  { icon: FileSpreadsheet, title: 'Esporta', text: 'Scarica in CSV o XLSX.' },
];

const generati = [
  'Titolo prodotto ottimizzato',
  'Descrizione breve',
  'Descrizione completa',
  'Elenchi puntati (bullet)',
  'Meta description',
];

/**
 * I pacchetti mostrati sulla landing.
 *
 * Nomi e descrizioni stanno qui; il PREZZO e i crediti vengono dal database,
 * dove li si può cambiare senza un rilascio. Un pacchetto senza prezzo non
 * compare: meglio non mostrarlo che mostrarlo senza dire quanto costa — ed era
 * esattamente il difetto, una sezione «Prezzi» che elencava solo «50 / 200 /
 * 500 crediti».
 */
const DESCRIZIONI: Record<string, { name: string; hint: string }> = {
  pack_50: { name: 'Starter', hint: 'Per un primo catalogo o test approfonditi.' },
  pack_200: { name: 'Business', hint: 'Per aggiornamenti stagionali ricorrenti.' },
  pack_500: { name: 'Pro', hint: 'Per cataloghi ampi e team.' },
};

async function pacchettiInVendita() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('billing_products')
    .select('key, credits, price_cents, currency')
    .eq('active', true)
    .not('price_cents', 'is', null)
    .order('credits', { ascending: true });
  return (data ?? []).map((p) => {
    const d = DESCRIZIONI[p.key] ?? { name: p.key, hint: '' };
    return {
      name: d.name,
      hint: d.hint,
      credits: p.credits,
      prezzo: p.price_cents == null ? null : formattaPrezzo(p.price_cents, p.currency ?? 'EUR'),
      perCredito:
        p.price_cents == null ? null : prezzoPerCredito(p.price_cents, p.credits, p.currency ?? 'EUR'),
    };
  });
}

const faq = [
  {
    q: 'Le descrizioni inventano caratteristiche non presenti?',
    a: 'No. Il sistema genera testo solo a partire dai dati che carichi. I fatti non forniti non vengono inventati e ogni scheda segnala eventuali avvisi.',
  },
  {
    q: 'Devo sottoscrivere un abbonamento?',
    a: 'No. Acquisti pacchetti di crediti quando ti servono. Nessun abbonamento obbligatorio.',
  },
  {
    q: 'Che formati posso importare ed esportare?',
    a: 'Puoi importare file CSV o Excel (XLSX) ed esportare i risultati in CSV o XLSX.',
  },
  {
    q: 'Posso rivedere i testi prima di pubblicarli?',
    a: 'Sì. Controlli i dati, approvi un campione e puoi modificare o rigenerare ogni scheda prima dell’export.',
  },
  {
    q: 'I miei dati sono al sicuro?',
    a: 'Ogni organizzazione vede solo i propri dati. I file caricati e i risultati sono isolati per account.',
  },
];

export default async function LandingPage() {
  const packs = await pacchettiInVendita();
  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Accedi
              </Button>
            </Link>
            <Link href="/login">
              {/* Diceva «Registrati» e portava su una pagina intitolata
                  «Accedi». Il percorso è uno solo, e questa etichetta dice
                  cosa si ottiene invece di promettere una pagina che non
                  esiste. */}
              <Button size="sm">Prova gratis</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">
              <Sparkles className="h-3.5 w-3.5 text-brand-accent" />
              Schede prodotto con AI verificata
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Da foto ed Excel a schede prodotto pronte da pubblicare
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
              L’AI legge etichette e listini, scrive descrizioni fedeli ai dati — mai
              inventate — e le esporta per Shopify, WooCommerce e PrestaShop. In 6 lingue.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login">
                <Button size="lg" className="w-full sm:w-auto">
                  Prova con 3 prodotti
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">
                  Accedi
                </Button>
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
              {[
                'Elaborazione in massa',
                'Nessuna caratteristica inventata',
                'Controllo prima dell’export',
                'CSV e XLSX',
                'Nessun abbonamento obbligatorio',
              ].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Problema */}
        <section className="border-y border-gray-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">
                  Scrivere schede a mano è lento e incoerente
                </h2>
                <p className="mt-4 text-gray-600">
                  Cataloghi con centinaia di articoli richiedono ore di copy
                  ripetitivo. Il risultato è spesso disomogeneo, con descrizioni
                  di qualità variabile e dati mancanti.
                </p>
              </div>
              <p className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-gray-700">
                Con Verificato parti dai dati che già possiedi: mappi le colonne
                una sola volta, definisci il tono del brand e generi tutte le
                schede mantenendo coerenza e controllo.
              </p>
            </div>
          </div>
        </section>

        {/* Come funziona */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-gray-900">
              Come funziona
            </h2>
            <p className="mt-2 text-gray-600">
              Un flusso lineare, dal file al catalogo pubblicabile.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((s, i) => (
              <Card key={s.title}>
                <CardContent className="p-6 pt-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand-accent">
                      <s.icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-medium text-gray-500">
                      Passo {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold text-gray-900">{s.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{s.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Cosa viene generato */}
        <section className="border-y border-gray-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">
                  Cosa viene generato
                </h2>
                <p className="mt-2 text-gray-600">
                  Per ogni prodotto ottieni tutti gli elementi testuali di una
                  scheda completa.
                </p>
                <ul className="mt-6 space-y-3">
                  {generati.map((g) => (
                    <li key={g} className="flex items-center gap-3 text-gray-700">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
              <Card>
                <CardContent className="space-y-3 p-6 pt-6">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Anteprima scheda
                  </div>
                  <div className="text-lg font-semibold text-gray-900">
                    Blazer sartoriale in lana
                  </div>
                  <p className="text-sm text-gray-600">
                    Giacca dal taglio strutturato in pura lana vergine, con
                    revers a lancia e chiusura monopetto.
                  </p>
                  <ul className="space-y-1 text-sm text-gray-600">
                    <li>• Composizione: 100% lana vergine</li>
                    <li>• Vestibilità regolare</li>
                    <li>• Chiusura a un bottone</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Sicurezza dati */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Card>
            <CardContent className="flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  I tuoi dati restano tuoi
                </h2>
                <p className="mt-1 text-gray-600">
                  Ogni organizzazione accede esclusivamente ai propri file e
                  risultati. I contenuti caricati vengono usati solo per generare
                  le tue schede, mai per altri account.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Prezzi */}
        <section className="border-y border-gray-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-gray-900">
                Pacchetti di crediti
              </h2>
              <p className="mt-2 text-gray-600">
                Un credito genera una scheda prodotto. Paghi solo ciò che usi,
                senza abbonamenti.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {packs.map((p, i) => (
                <Card
                  key={p.name}
                  className={i === 1 ? 'border-brand-accent ring-1 ring-brand-accent' : ''}
                >
                  <CardContent className="p-6 pt-6 text-center">
                    <div className="text-sm font-medium text-gray-500">
                      {p.name}
                    </div>
                    {/* Il PREZZO prima di tutto: era l'unica cosa che mancava,
                        e senza di lui la sezione «Prezzi» non diceva prezzi. */}
                    <div className="mt-3 text-4xl font-bold text-gray-900">
                      {p.prezzo ?? '—'}
                    </div>
                    <div className="text-sm text-gray-500">
                      {p.credits} crediti
                      {p.perCredito && <> · {p.perCredito} a scheda</>}
                    </div>
                    <p className="mt-3 text-sm text-gray-600">{p.hint}</p>
                    <Link href="/login" className="mt-6 block">
                      <Button
                        className="w-full"
                        variant={i === 1 ? 'primary' : 'outline'}
                      >
                        Inizia
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-semibold text-gray-900">
            Domande frequenti
          </h2>
          <div className="mt-8 space-y-4">
            {faq.map((f) => (
              <Card key={f.q}>
                <CardContent className="p-6 pt-6">
                  <h3 className="font-semibold text-gray-900">{f.q}</h3>
                  <p className="mt-2 text-sm text-gray-600">{f.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/login">
              <Button size="lg">
                Prova con 3 prodotti
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Logo />
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <Link href="/login" className="inline-flex items-center -my-2 py-2 hover:text-gray-900">
              Accedi
            </Link>
            <Link href="/privacy" className="inline-flex items-center -my-2 py-2 hover:text-gray-900">
              Privacy
            </Link>
            <Link href="/termini" className="inline-flex items-center -my-2 py-2 hover:text-gray-900">
              Termini
            </Link>
            <Link href="/cookie" className="inline-flex items-center -my-2 py-2 hover:text-gray-900">
              Cookie
            </Link>
          </div>
          <p className="text-sm text-gray-500">
            © {new Date().getFullYear()} Verificato
          </p>
        </div>
      </footer>
    </div>
  );
}
