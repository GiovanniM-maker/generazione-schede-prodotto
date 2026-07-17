'use server';

import { createAiProviders } from '@app/ai';
import type { Json } from '@app/database';
import { getServerEnv } from '@/lib/env.server';
import { getSessionUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase/service';

// Genera e salva un profilo tono versionato per l'organizzazione.
export async function createToneProfileAction(input: {
  organizationId: string;
  name: string;
  style: string;
  examples?: string[];
  forbiddenWords?: string[];
  guidance?: string;
  batchId?: string;
}): Promise<{ brandProfileId: string; versionId: string }> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non autenticato');

  const service = getServiceClient();
  const { data: member } = await service
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) throw new Error('Organizzazione non accessibile');

  const env = getServerEnv();
  const providers = createAiProviders(env);
  const { data: profile } = await providers.brandProfile.generateProfile({
    selectedStyle: input.style,
    examples: input.examples ?? [],
    forbiddenWords: input.forbiddenWords,
    guidance: input.guidance,
  });

  const { data: bp, error: bpErr } = await service
    .from('brand_profiles')
    .insert({ organization_id: input.organizationId, name: input.name || 'Profilo brand' })
    .select('id')
    .single();
  if (bpErr || !bp) throw new Error(`Creazione profilo fallita: ${bpErr?.message}`);

  const { data: version, error: vErr } = await service
    .from('brand_profile_versions')
    .insert({
      brand_profile_id: bp.id,
      version: 1,
      profile_json: profile as unknown as Json,
      source_type: 'ai',
      approved_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (vErr || !version) throw new Error(`Versione profilo fallita: ${vErr?.message}`);

  await service.from('brand_profiles').update({ active_version_id: version.id }).eq('id', bp.id);

  if (input.examples && input.examples.length > 0) {
    await service.from('brand_examples').insert(
      input.examples.filter(Boolean).map((text) => ({
        brand_profile_version_id: version.id,
        original_text: text,
      })),
    );
  }

  if (input.batchId) {
    await service
      .from('batches')
      .update({ brand_profile_version_id: version.id, status: 'tone_setup' })
      .eq('id', input.batchId);
  }

  await service.from('app_events').insert({
    organization_id: input.organizationId,
    user_id: user.id,
    event_name: 'onboarding_completed',
    metadata_json: { style: input.style },
  });

  return { brandProfileId: bp.id, versionId: version.id };
}
