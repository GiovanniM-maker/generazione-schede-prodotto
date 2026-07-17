import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  OnboardingStepper,
  type CatalogAttribute,
  type CatalogCategory,
  type CatalogSector,
} from '@/components/onboarding-stepper';

export const dynamic = 'force-dynamic';

// Costruisce il catalogo di configurazione DIRETTAMENTE dal DB (data-driven):
// settori attivi -> categorie di sistema -> attributi (via category_attributes).
async function loadCatalog(): Promise<CatalogSector[]> {
  const supabase = await createSupabaseServerClient();

  const { data: sectors } = await supabase
    .from('sectors')
    .select('id, key, name, description, icon')
    .eq('status', 'active')
    .order('name', { ascending: true });
  if (!sectors || sectors.length === 0) return [];

  const sectorIds = sectors.map((s) => s.id);

  const { data: categories } = await supabase
    .from('categories')
    .select('id, sector_id, name, description')
    .in('sector_id', sectorIds)
    .eq('is_system', true)
    .eq('status', 'active')
    .order('name', { ascending: true });

  const categoryIds = (categories ?? []).map((c) => c.id);

  const { data: links } = categoryIds.length
    ? await supabase
        .from('category_attributes')
        .select('category_id, attribute_id, is_required, display_order')
        .in('category_id', categoryIds)
        .order('display_order', { ascending: true })
    : { data: [] as const };

  const attributeIds = Array.from(
    new Set((links ?? []).map((l) => l.attribute_id)),
  );

  const { data: attributes } = attributeIds.length
    ? await supabase
        .from('attributes')
        .select('id, name, description, data_type, is_system')
        .in('id', attributeIds)
    : { data: [] as const };

  const attrById = new Map(
    (attributes ?? []).map((a) => [a.id, a]),
  );

  const catAttrs = new Map<string, CatalogAttribute[]>();
  for (const link of links ?? []) {
    const base = attrById.get(link.attribute_id);
    if (!base) continue;
    const list = catAttrs.get(link.category_id) ?? [];
    list.push({
      id: base.id,
      name: base.name,
      description: base.description,
      dataType: base.data_type,
      isRequired: link.is_required,
      displayOrder: link.display_order,
      isSystem: base.is_system,
    });
    catAttrs.set(link.category_id, list);
  }

  const catsBySector = new Map<string, CatalogCategory[]>();
  for (const c of categories ?? []) {
    const list = catsBySector.get(c.sector_id) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      description: c.description,
      attributes: (catAttrs.get(c.id) ?? []).sort(
        (a, b) => a.displayOrder - b.displayOrder,
      ),
    });
    catsBySector.set(c.sector_id, list);
  }

  return sectors.map((s) => ({
    id: s.id,
    key: s.key ?? '',
    name: s.name,
    description: s.description,
    icon: s.icon,
    categories: catsBySector.get(s.id) ?? [],
  }));
}

export default async function OnboardingPage() {
  const user = await requireUser();
  const catalog = await loadCatalog();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">
          Benvenuto in Schede Prodotto
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Configuriamo il sistema in base ai prodotti della tua azienda.
        </p>
      </div>
      <OnboardingStepper catalog={catalog} userEmail={user.email ?? null} />
    </div>
  );
}
