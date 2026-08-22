'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Layers,
  Loader2,
} from 'lucide-react';
import {
  completeOnboardingAction,
  createInitialPresetAction,
  getOnboardingDataAction,
  saveAttributeSelectionAction,
  saveCategoriesAction,
  saveCompanyAction,
  selectSectorAction,
  type AttributeSelectionItem,
  type PresetAttributeInput,
} from '@/lib/actions/onboarding';
import { createToneProfileAction } from '@/lib/actions/tone';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avviso } from '@/components/ui/avviso';
import { Aiuto } from '@/components/ui/suggerimento';
import { motivoMancante } from '@app/core/comandi';
import { cn } from '@/lib/utils';
import { etichettaTipoDato } from '@/lib/tipi-dato';

// ---------------------------------------------------------------------
// Tipi del catalogo (data-driven, forniti dal Server Component).
// ---------------------------------------------------------------------
export interface CatalogAttribute {
  id: string;
  name: string;
  description: string | null;
  dataType: string;
  isRequired: boolean;
  displayOrder: number;
  isSystem: boolean;
}
export interface CatalogCategory {
  id: string;
  name: string;
  description: string | null;
  attributes: CatalogAttribute[];
}
export interface CatalogSector {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  categories: CatalogCategory[];
}

interface AttrOverride {
  enabled: boolean;
  isRequired: boolean;
}

const TOTAL = 7;

const STEP_TITLES = [
  'Azienda',
  'Settore',
  'Categorie',
  'Attributi',
  'Preset iniziale',
  'Profilo del brand',
  'Completamento',
];

const COUNTRIES = ['Italia', 'Francia', 'Germania', 'Spagna', 'Svizzera', 'Altro'];
const LANGUAGES = ['Italiano', 'Inglese', 'Francese', 'Tedesco', 'Spagnolo'];

const STYLES: { value: string; label: string; desc: string }[] = [
  {
    value: 'Essenziale e diretto',
    label: 'Essenziale e diretto',
    desc: 'Frasi brevi, informazioni chiare, nessun fronzolo.',
  },
  {
    value: 'Elegante e ricercato',
    label: 'Elegante e ricercato',
    desc: 'Tono raffinato, lessico curato, atmosfera premium.',
  },
  {
    value: 'Commerciale e coinvolgente',
    label: 'Commerciale e coinvolgente',
    desc: 'Linguaggio persuasivo ma corretto, orientato alla conversione.',
  },
  {
    value: 'Personalizzato',
    label: 'Personalizzato',
    desc: 'Descrivi tu il tono desiderato.',
  },
];

function attrKey(categoryId: string, attributeId: string): string {
  return `${categoryId}:${attributeId}`;
}

export function OnboardingStepper({
  catalog,
  userEmail,
}: {
  catalog: CatalogSector[];
  userEmail: string | null;
}) {
  const router = useRouter();

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [organizationId, setOrganizationId] = useState<string | null>(null);

  // Step 1 — azienda
  const [name, setName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [email, setEmail] = useState(userEmail ?? '');
  const [website, setWebsite] = useState('');
  const [country, setCountry] = useState('Italia');
  const [language, setLanguage] = useState('Italiano');

  // Step 2 — settore
  const [sectorId, setSectorId] = useState<string | null>(null);

  // Step 3 — categorie
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Step 4 — override attributi (keyed by "categoryId:attributeId")
  const [overrides, setOverrides] = useState<Record<string, AttrOverride>>({});

  // Step 5 — preset
  const [presetName, setPresetName] = useState('Preset principale');
  const [presetCreated, setPresetCreated] = useState(false);

  // Step 6 — brand
  const [style, setStyle] = useState('');
  const [custom, setCustom] = useState('');
  const [example1, setExample1] = useState('');
  const [example2, setExample2] = useState('');
  const [brandDone, setBrandDone] = useState(false);

  const selectedSector = useMemo(
    () => catalog.find((s) => s.id === sectorId) ?? null,
    [catalog, sectorId],
  );

  const selectedCategories = useMemo(() => {
    if (!selectedSector) return [];
    return selectedSector.categories.filter((c) => categoryIds.includes(c.id));
  }, [selectedSector, categoryIds]);

  function effective(cat: CatalogCategory, attr: CatalogAttribute): AttrOverride {
    const o = overrides[attrKey(cat.id, attr.id)];
    return o ?? { enabled: true, isRequired: attr.isRequired };
  }

  // Riprende l'onboarding dal punto giusto.
  useEffect(() => {
    let active = true;
    (async () => {
      const res = await getOnboardingDataAction();
      if (!active) return;
      if (res.ok && res.state) {
        const s = res.state;
        setOrganizationId(s.organizationId);
        if (s.name) setName(s.name);
        if (s.sectorId) setSectorId(s.sectorId);
        if (s.categoryIds.length) setCategoryIds(s.categoryIds);
        if (s.attributeSelection.length) {
          const map: Record<string, AttrOverride> = {};
          for (const item of s.attributeSelection) {
            map[attrKey(item.categoryId, item.attributeId)] = {
              enabled: item.enabled,
              isRequired: item.isRequired,
            };
          }
          setOverrides(map);
        }
        if (s.onboardingCompletedAt) {
          router.replace('/app');
          return;
        }
        if (s.hasBrandProfile) {
          setBrandDone(true);
          setStep(7);
        } else if (s.hasPreset) {
          setPresetCreated(true);
          setStep(6);
        } else if (s.attributeSelection.length) setStep(5);
        else if (s.categoryIds.length) setStep(4);
        else if (s.sectorId) setStep(3);
        else setStep(1);
      }
      setLoadingInitial(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  function toggleCategory(id: string) {
    setCategoryIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  function setOverride(cat: CatalogCategory, attr: CatalogAttribute, patch: Partial<AttrOverride>) {
    setOverrides((prev) => {
      const key = attrKey(cat.id, attr.id);
      const cur = prev[key] ?? { enabled: true, isRequired: attr.isRequired };
      return { ...prev, [key]: { ...cur, ...patch } };
    });
  }

  // ---- azioni per step ----
  async function submitCompany() {
    setLoading(true);
    setError(null);
    try {
      const res = await saveCompanyAction({
        name,
        brandName,
        email,
        website: website.trim() || undefined,
        country,
        language,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOrganizationId(res.organizationId);
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function submitSector() {
    if (!organizationId || !sectorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await selectSectorAction({ organizationId, sectorId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStep(3);
    } finally {
      setLoading(false);
    }
  }

  async function submitCategories() {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await saveCategoriesAction({ organizationId, categoryIds });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStep(4);
    } finally {
      setLoading(false);
    }
  }

  function buildSelection(): AttributeSelectionItem[] {
    const items: AttributeSelectionItem[] = [];
    for (const cat of selectedCategories) {
      for (const attr of cat.attributes) {
        const e = effective(cat, attr);
        items.push({
          categoryId: cat.id,
          attributeId: attr.id,
          isRequired: e.isRequired,
          enabled: e.enabled,
        });
      }
    }
    return items;
  }

  async function submitAttributes() {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await saveAttributeSelectionAction({
        organizationId,
        selection: buildSelection(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStep(5);
    } finally {
      setLoading(false);
    }
  }

  async function submitPreset() {
    if (!organizationId || !sectorId) return;
    setLoading(true);
    setError(null);
    try {
      const attributes: PresetAttributeInput[] = [];
      for (const cat of selectedCategories) {
        for (const attr of cat.attributes) {
          const e = effective(cat, attr);
          attributes.push({
            categoryId: cat.id,
            attributeId: attr.id,
            isRequired: e.isRequired,
            enabled: e.enabled,
            displayOrder: attr.displayOrder,
          });
        }
      }
      const res = await createInitialPresetAction({
        organizationId,
        sectorId,
        name: presetName,
        categoryIds,
        attributes,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPresetCreated(true);
      setStep(6);
    } finally {
      setLoading(false);
    }
  }

  async function generateBrand() {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const guidance =
        style === 'Personalizzato' && custom.trim()
          ? custom.trim()
          : website.trim()
            ? `Sito di riferimento: ${website.trim()}`
            : undefined;
      const examples = [example1, example2].map((e) => e.trim()).filter(Boolean);
      const res = await createToneProfileAction({
        organizationId,
        name: brandName.trim() || name.trim() || 'Profilo brand',
        style:
          style === 'Personalizzato' ? custom.trim() || 'Personalizzato' : style,
        examples: examples.length ? examples : undefined,
        guidance,
      });
      if (!res.ok) {
        setError(
          res.error ??
            'Impossibile generare il profilo del brand. Puoi saltare e completare comunque.',
        );
        return;
      }
      setBrandDone(true);
      setStep(7);
    } finally {
      setLoading(false);
    }
  }

  async function finish() {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await completeOnboardingAction({ organizationId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace('/app');
    } finally {
      setLoading(false);
    }
  }

  if (loadingInitial) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-16 text-ink-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Caricamento…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        {/* Progresso */}
        <div className="mb-2 flex items-center gap-1.5">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                i < step ? 'bg-brand-accent' : 'bg-ink-200',
              )}
            />
          ))}
        </div>
        <p className="mb-6 text-xs font-medium text-ink-500">
          Passaggio {step} di {TOTAL} · {STEP_TITLES[step - 1]}
        </p>

        {/* ---------------- Step 1: Azienda ---------------- */}
        {step === 1 && (
          // Un modulo vero, non una fila di campi.
          //
          // `onSubmit` porta Invio da tastiera; su telefono cambia anche il
          // tasto della tastiera, che smette di dire «a capo» e dice «vai»; e
          // il gestore di password riconosce il modulo. Il pulsante però sta
          // nella barra in fondo, fuori da qui: `form="passo-azienda"` lo
          // collega lo stesso — è a questo che serve quell'attributo.
          <form
            id="passo-azienda"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && name.trim()) void submitCompany();
            }}
          >
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                Configuriamo il sistema
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Configuriamo il sistema in base ai prodotti della tua azienda.
                Iniziamo con qualche informazione di base.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Nome azienda</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Es. Cascina Verde S.r.l."
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="brand">Nome brand</Label>
                <Input
                  id="brand"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Es. Cascina Verde"
                />
              </div>
              <div>
                <Label htmlFor="email">Email di riferimento</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@esempio.it"
                />
              </div>
              <div>
                <Label htmlFor="website">Sito web (opzionale)</Label>
                <Input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://www.esempio.it"
                />
              </div>
              <div>
                <Label htmlFor="country">Paese</Label>
                <Select
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="language">Lingua principale</Label>
                <Select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </form>
        )}

        {/* ---------------- Step 2: Settore ---------------- */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                Qual è il tuo settore?
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Il settore determina le categorie e gli attributi disponibili per
                le tue schede prodotto. Potrai modificare tutto successivamente.
              </p>
            </div>
            <div className="grid gap-3">
              {catalog.map((s) => {
                const active = sectorId === s.id;
                const exCats = s.categories.slice(0, 4).map((c) => c.name);
                const exAttrs = Array.from(
                  new Set(
                    s.categories.flatMap((c) => c.attributes.map((a) => a.name)),
                  ),
                ).slice(0, 6);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSectorId(s.id)}
                    className={cn(
                      'rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                      active
                        ? 'border-brand-accent bg-brand-soft/70 ring-1 ring-brand-accent'
                        : 'border-ink-200 hover:border-ink-300',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                          <Layers className="h-4 w-4" />
                        </span>
                        <span className="font-medium text-ink-900">{s.name}</span>
                      </div>
                      {active && <Check className="h-4 w-4 text-brand-accent" />}
                    </div>
                    {s.description && (
                      <p className="mt-2 text-sm text-ink-500">{s.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <Badge tone="blue">
                        {s.categories.length} categorie disponibili
                      </Badge>
                    </div>
                    {exCats.length > 0 && (
                      <p className="mt-2 text-xs text-ink-500">
                        <span className="font-medium text-ink-600">
                          Categorie:
                        </span>{' '}
                        {exCats.join(', ')}
                        {s.categories.length > exCats.length ? '…' : ''}
                      </p>
                    )}
                    {exAttrs.length > 0 && (
                      <p className="mt-1 text-xs text-ink-500">
                        <span className="font-medium text-ink-600">
                          Attributi:
                        </span>{' '}
                        {exAttrs.join(', ')}…
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-ink-500">
              Potrai modificare tutto successivamente.
            </p>
          </div>
        )}

        {/* ---------------- Step 3: Categorie ---------------- */}
        {step === 3 && selectedSector && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                Quali categorie tratti?
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Seleziona le categorie di prodotto del tuo catalogo. Per ognuna
                puoi vedere gli attributi suggeriti.
              </p>
            </div>
            <div className="grid gap-3">
              {selectedSector.categories.map((c) => {
                const active = categoryIds.includes(c.id);
                const mainAttrs = c.attributes.slice(0, 4).map((a) => a.name);
                const expanded = expandedCategory === c.id;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      'rounded-lg border p-4 transition-colors',
                      active
                        ? 'border-brand-accent bg-brand-soft/50 ring-1 ring-brand-accent'
                        : 'border-ink-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex flex-1 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleCategory(c.id)}
                          className="mt-1 h-4 w-4 rounded border-ink-300 text-brand-accent focus:ring-brand-accent"
                        />
                        <span>
                          <span className="block font-medium text-ink-900">
                            {c.name}
                          </span>
                          {c.description && (
                            <span className="mt-0.5 block text-sm text-ink-500">
                              {c.description}
                            </span>
                          )}
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone="gray">
                              {c.attributes.length} attributi
                            </Badge>
                            {mainAttrs.map((a) => (
                              <Badge key={a} tone="blue">
                                {a}
                              </Badge>
                            ))}
                          </span>
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCategory(expanded ? null : c.id)
                        }
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-accent hover:underline"
                      >
                        Visualizza attributi
                        <ChevronDown
                          className={cn(
                            'h-3.5 w-3.5 transition-transform',
                            expanded && 'rotate-180',
                          )}
                        />
                      </button>
                    </div>
                    {expanded && (
                      <ul className="mt-3 grid gap-1 border-t border-ink-200 pt-3 text-sm text-ink-600 sm:grid-cols-2">
                        {c.attributes.map((a) => (
                          <li key={a.id} className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />
                            {a.name}
                            {a.isRequired && (
                              <span className="text-xs text-amber-600">
                                (obbligatorio)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------------- Step 4: Attributi ---------------- */}
        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                Attributi iniziali
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Questi sono gli attributi iniziali suggeriti per le categorie
                selezionate.
              </p>
              <dl className="mt-3 space-y-1.5 rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-ink-900">Attivo</dt>
                  <dd className="text-ink-600">
                    L&apos;attributo fa parte del preset: viene cercato nei tuoi dati e nelle
                    foto, finisce nella scheda e nell&apos;export. Se lo spegni, è come se non
                    esistesse.
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-ink-900">Obbligatorio</dt>
                  <dd className="text-ink-600">
                    Serve a giudicare la scheda, non a forzarla: se ci sono tutti gli
                    obbligatori la scheda risulta <strong>completa</strong>, se ne manca
                    qualcuno <strong>parziale</strong>. Non fa mai inventare un dato mancante.
                  </dd>
                </div>
              </dl>
            </div>
            {selectedCategories.map((cat) => (
              <div
                key={cat.id}
                className="rounded-lg border border-ink-200"
              >
                <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
                  <span className="font-medium text-ink-900">{cat.name}</span>
                </div>
                <ul className="divide-y divide-ink-100">
                  {cat.attributes.map((attr) => {
                    const e = effective(cat, attr);
                    return (
                      <li
                        key={attr.id}
                        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'font-medium',
                                e.enabled ? 'text-ink-900' : 'text-ink-500 line-through',
                              )}
                            >
                              {attr.name}
                            </span>
                            <Badge tone="gray">
                              {etichettaTipoDato(attr.dataType)}
                            </Badge>
                            <Badge tone={attr.isSystem ? 'violet' : 'amber'}>
                              {attr.isSystem ? 'sistema' : 'personalizzato'}
                            </Badge>
                          </div>
                          {attr.description && (
                            <p className="mt-0.5 text-xs text-ink-500">
                              {attr.description}
                            </p>
                          )}
                        </div>
                        {/* Prima "Attivo": è l'interruttore. "Obbligatorio" ha
                            senso solo se l'attributo è attivo, per questo si
                            disabilita da solo. */}
                        {/* Le due spiegazioni stavano su un `title` del
                            `<label>`. Un'etichetta non prende il fuoco: con la
                            tastiera erano irraggiungibili, e sul telefono pure.
                            Ora sono un comando vero accanto alla casella. */}
                        <div className="flex shrink-0 items-center gap-3 text-sm">
                          <span className="flex items-center gap-1">
                            <label className="flex items-center gap-1.5 text-ink-600">
                              <input
                                type="checkbox"
                                checked={e.enabled}
                                onChange={(ev) =>
                                  setOverride(cat, attr, {
                                    enabled: ev.target.checked,
                                  })
                                }
                                className="h-4 w-4 rounded border-ink-300 text-brand-accent focus:ring-brand-accent"
                              />
                              Attivo
                            </label>
                            <Aiuto testo="Se spento, l'attributo non viene estratto né generato né esportato." />
                          </span>
                          <span className="flex items-center gap-1">
                            <label className="flex items-center gap-1.5 text-ink-600">
                              <input
                                type="checkbox"
                                checked={e.isRequired}
                                disabled={!e.enabled}
                                onChange={(ev) =>
                                  setOverride(cat, attr, {
                                    isRequired: ev.target.checked,
                                  })
                                }
                                className="h-4 w-4 rounded border-ink-300 text-brand-accent focus:ring-brand-accent disabled:opacity-40"
                              />
                              Obbligatorio
                            </label>
                            <Aiuto testo="Se manca, la scheda risulta parziale invece che completa. Non fa inventare il dato." />
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* ---------------- Step 5: Preset iniziale ---------------- */}
        {step === 5 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                Preset iniziale
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Creiamo il preset principale della tua azienda. Definisce quali
                categorie, attributi e campi generati usare per le schede.
              </p>
            </div>
            <div>
              <Label htmlFor="presetName">Nome del preset</Label>
              <Input
                id="presetName"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </div>
            <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-ink-500">Settore</span>
                <span className="font-medium text-ink-900">
                  {selectedSector?.name ?? '—'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-ink-500">Categorie attive</span>
                <span className="font-medium text-ink-900">
                  {selectedCategories.length}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-ink-500">Attributi attivi</span>
                <span className="font-medium text-ink-900">
                  {buildSelection().filter((a) => a.enabled).length}
                </span>
              </div>
              <div className="border-t border-ink-200 pt-2">
                <span className="text-ink-500">Campi generati</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {['Titolo', 'Descrizione breve', 'Descrizione lunga', 'Punti elenco', 'Meta description'].map(
                    (f) => (
                      <Badge key={f} tone="green">
                        {f}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- Step 6: Profilo del brand ---------------- */}
        {step === 6 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                Profilo del brand
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Definisce il tono di voce delle descrizioni generate. Puoi anche
                saltare questo passaggio e configurarlo più tardi.
              </p>
            </div>
            <div className="grid gap-3">
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStyle(s.value)}
                  className={cn(
                    'rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                    style === s.value
                      ? 'border-brand-accent bg-brand-soft/70 ring-1 ring-brand-accent'
                      : 'border-ink-200 hover:border-ink-300',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink-900">{s.label}</span>
                    {style === s.value && (
                      <Check className="h-4 w-4 text-brand-accent" />
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-500">{s.desc}</p>
                </button>
              ))}
            </div>
            {style === 'Personalizzato' && (
              <div>
                <Label htmlFor="custom">Descrivi il tono desiderato</Label>
                <Textarea
                  id="custom"
                  rows={3}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Es. tono giovane e ironico, con riferimenti allo streetwear."
                />
              </div>
            )}
            <div>
              <Label htmlFor="ex1">Esempi di descrizioni (opzionale)</Label>
              <Textarea
                id="ex1"
                rows={2}
                value={example1}
                onChange={(e) => setExample1(e.target.value)}
                placeholder="Incolla qui una descrizione esistente…"
              />
              <Textarea
                aria-label="Secondo esempio di descrizione"
                className="mt-2"
                rows={2}
                value={example2}
                onChange={(e) => setExample2(e.target.value)}
                placeholder="Secondo esempio (opzionale)"
              />
            </div>
          </div>
        )}

        {/* ---------------- Step 7: Completamento ---------------- */}
        {step === 7 && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Check className="h-7 w-7" />
              </span>
              <h2 className="text-xl font-semibold text-ink-900">
                Configurazione quasi pronta
              </h2>
              <p className="max-w-md text-sm text-ink-500">
                Abbiamo configurato settore, categorie, attributi e il preset
                principale della tua azienda. Conferma per accedere alla
                dashboard e creare il primo batch.
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm">
              <ChecklistRow label="Azienda configurata" done={!!organizationId} />
              <ChecklistRow label="Settore selezionato" done={!!sectorId} />
              <ChecklistRow
                label={`${selectedCategories.length} categorie configurate`}
                done={selectedCategories.length > 0}
              />
              <ChecklistRow label="Preset principale creato" done={presetCreated} />
              <ChecklistRow
                label="Profilo del brand"
                done={brandDone}
                optional
              />
            </div>
          </div>
        )}

        {/* Errore */}
        {error && (
          <Avviso tono="errore" className="mt-6">
            {error}
          </Avviso>
        )}

        {/* Navigazione */}
        <div className="mt-8 flex items-center justify-between gap-3">
          {step > 1 && step < 7 ? (
            <Button variant="ghost" onClick={back} disabled={loading}>
              <ArrowLeft className="h-4 w-4" />
              Indietro
            </Button>
          ) : (
            <span />
          )}

          {/* Va a capo sotto i 360px: «Salta per ora» + «Genera profilo»
              affiancati non entrano, e senza wrap spingevano la pagina fuori
              dallo schermo di 28px. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {step === 6 && (
              <Button variant="outline" onClick={() => setStep(7)} disabled={loading}>
                Salta per ora
              </Button>
            )}

            {/* `loading` invece della rotella infilata a mano: l'etichetta
                resta, quindi il comando non si restringe e la barra non salta.
                E `nonDisponibile` invece di `disabled`: prima il pulsante si
                spegneva e basta, e chi non capiva cosa mancasse non aveva un
                posto dove leggerlo — su telefono, dove l'autocompilazione
                spesso non fa scattare la validazione, restava spento con il
                modulo GIÀ giusto. */}
            {step === 1 && (
              <Button
                type="submit"
                form="passo-azienda"
                loading={loading}
                nonDisponibile={motivoMancante([
                  { manca: !name.trim(), cosa: 'il nome dell’azienda' },
                ])}
              >
                Continua
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 2 && (
              <Button
                onClick={submitSector}
                loading={loading}
                nonDisponibile={motivoMancante([{ manca: !sectorId, cosa: 'il settore' }])}
              >
                Continua
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button
                onClick={submitCategories}
                loading={loading}
                nonDisponibile={motivoMancante([
                  { manca: categoryIds.length === 0, cosa: 'almeno una categoria' },
                ])}
              >
                Continua
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 4 && (
              <Button onClick={submitAttributes} loading={loading}>
                Continua
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 5 && (
              <Button
                onClick={submitPreset}
                loading={loading}
                nonDisponibile={motivoMancante([
                  { manca: !presetName.trim(), cosa: 'il nome del preset' },
                ])}
              >
                Crea preset
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 6 && (
              <Button
                onClick={generateBrand}
                loading={loading}
                nonDisponibile={motivoMancante([
                  { manca: !style, cosa: 'il tono di voce' },
                  {
                    manca: style === 'Personalizzato' && !custom.trim(),
                    cosa: 'la descrizione del tono personalizzato',
                  },
                ])}
              >
                {loading ? 'Generazione…' : (
                  <>
                    Genera profilo
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
            {step === 7 && (
              <Button onClick={finish} loading={loading}>
                Vai alla dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChecklistRow({
  label,
  done,
  optional,
}: {
  label: string;
  done: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full',
          done ? 'bg-emerald-100 text-emerald-600' : 'bg-ink-200 text-ink-500',
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      <span className={cn('text-ink-700', !done && 'text-ink-500')}>
        {label}
        {optional && !done && (
          <span className="ml-1 text-xs text-ink-500">(opzionale)</span>
        )}
      </span>
    </div>
  );
}
