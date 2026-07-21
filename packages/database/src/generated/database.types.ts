// ---------------------------------------------------------------------------
// Tipi database. In un progetto reale questo file è generato con:
//   supabase gen types typescript --local > src/generated/database.types.ts
// Qui è versionato a mano per riflettere le migrazioni. Rigenerare dopo ogni
// modifica allo schema. Le colonne *_json sono `Json`.
// ---------------------------------------------------------------------------

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** Helper: da una Row deriva Insert (parziale) e Update (parziale). */
type T<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

type Timestamps = { created_at: string; updated_at: string };

export interface Database {
  public: {
    Tables: {
      organizations: T<
        {
          id: string;
          name: string;
          slug: string;
          stripe_customer_id: string | null;
          onboarding_completed_at: string | null;
        } & Timestamps
      >;
      organization_members: T<{
        id: string;
        organization_id: string;
        user_id: string;
        role: 'owner' | 'member';
        created_at: string;
      }>;
      // presets / preset_versions ridefiniti nel modello v2 più in basso.
      brand_profiles: T<
        {
          id: string;
          organization_id: string;
          name: string;
          active_version_id: string | null;
        } & Timestamps
      >;
      brand_profile_versions: T<{
        id: string;
        brand_profile_id: string;
        version: number;
        profile_json: Json;
        source_type: string;
        created_at: string;
        approved_at: string | null;
      }>;
      brand_examples: T<{
        id: string;
        brand_profile_version_id: string;
        original_text: string;
        source_url: string | null;
        created_at: string;
      }>;
      batches: T<
        {
          id: string;
          organization_id: string;
          preset_version_id: string | null;
          brand_profile_version_id: string | null;
          name: string;
          status: string;
          source_type: string | null;
          total_products: number;
          valid_products: number;
          invalid_products: number;
          processed_products: number;
          failed_products: number;
          credits_reserved: number;
          started_at: string | null;
          completed_at: string | null;
          notify_email: string | null;
          notified_at: string | null;
        } & Timestamps
      >;
      source_files: T<{
        id: string;
        organization_id: string;
        batch_id: string | null;
        storage_bucket: string;
        storage_path: string;
        original_filename: string;
        mime_type: string;
        size_bytes: number;
        sha256: string;
        status: string;
        created_at: string;
      }>;
      import_mappings: T<
        {
          id: string;
          organization_id: string;
          preset_version_id: string | null;
          name: string;
          mapping_json: Json;
        } & Timestamps
      >;
      batch_imports: T<{
        id: string;
        batch_id: string;
        source_file_id: string;
        import_mapping_id: string | null;
        detected_headers_json: Json;
        confirmed_mapping_json: Json;
        parse_summary_json: Json;
        created_at: string;
      }>;
      products: T<
        {
          id: string;
          organization_id: string;
          batch_id: string;
          external_id: string | null;
          parent_external_id: string | null;
          name: string | null;
          product_type: string | null;
          category: string | null;
          category_id: string | null;
          sku: string | null;
          preset_version_id: string | null;
          raw_input_json: Json;
          canonical_attributes_json: Json;
          input_hash: string | null;
          data_quality_score: number;
          verification_status: string | null;
        } & Timestamps
      >;
      batch_sources: T<
        {
          id: string;
          organization_id: string;
          batch_id: string;
          source_type: string;
          status: string;
          configuration_json: Json;
        } & Timestamps
      >;
      source_items: T<{
        id: string;
        organization_id: string;
        batch_source_id: string;
        source_file_id: string | null;
        external_source_id: string | null;
        filename: string;
        mime_type: string | null;
        size_bytes: number;
        sha256: string | null;
        detected_sku: string | null;
        status: string;
        metadata_json: Json;
        created_at: string;
      }>;
      product_source_links: T<{
        id: string;
        organization_id: string;
        product_id: string;
        source_item_id: string;
        link_type: string;
        created_at: string;
      }>;
      product_attribute_values: T<
        {
          id: string;
          organization_id: string;
          product_id: string;
          attribute_id: string;
          value_json: Json | null;
          status: string;
          source_type: string;
          source_item_id: string | null;
          source_locator: string | null;
          confidence: number | null;
          confirmed_by: string | null;
          confirmed_at: string | null;
        } & Timestamps
      >;
      product_variants: T<
        {
          id: string;
          product_id: string;
          external_id: string | null;
          sku: string | null;
          color: string | null;
          size: string | null;
          variant_attributes_json: Json;
        } & Timestamps
      >;
      product_assets: T<{
        id: string;
        organization_id: string;
        product_id: string;
        variant_id: string | null;
        source_file_id: string;
        asset_type: string;
        sort_order: number;
        match_method: string;
        created_at: string;
      }>;
      attribute_evidence: T<{
        id: string;
        organization_id: string;
        product_id: string;
        variant_id: string | null;
        field_key: string;
        value_json: Json;
        source_type: string;
        source_file_id: string | null;
        source_locator: string | null;
        evidence_text: string | null;
        confidence: number | null;
        status: string;
        confirmed_by: string | null;
        confirmed_at: string | null;
        created_at: string;
      }>;
      generation_runs: T<{
        id: string;
        organization_id: string;
        batch_id: string;
        run_type: string;
        provider: string;
        model: string;
        prompt_version: string;
        status: string;
        input_tokens: number;
        output_tokens: number;
        estimated_cost: number;
        started_at: string | null;
        completed_at: string | null;
        created_at: string;
      }>;
      product_generations: T<
        {
          id: string;
          organization_id: string;
          product_id: string;
          generation_run_id: string;
          input_hash: string;
          generated_content_json: Json;
          edited_content_json: Json | null;
          audit_json: Json | null;
          completeness_json: Json | null;
          translations_json: Json;
          status: string;
          accepted_at: string | null;
        } & Timestamps
      >;
      job_items: T<
        {
          id: string;
          organization_id: string;
          batch_id: string;
          product_id: string;
          status: string;
          attempts: number;
          last_error_code: string | null;
          last_error_message: string | null;
          locked_at: string | null;
          started_at: string | null;
          completed_at: string | null;
        } & Timestamps
      >;
      exports: T<{
        id: string;
        organization_id: string;
        batch_id: string;
        format: 'csv' | 'xlsx';
        mapping_json: Json;
        storage_bucket: string;
        storage_path: string;
        row_count: number;
        created_at: string;
      }>;
      billing_products: T<{
        id: string;
        key: string;
        name: string;
        stripe_price_id: string | null;
        credits: number;
        active: boolean;
        created_at: string;
      }>;
      credit_ledger: T<{
        id: string;
        organization_id: string;
        amount: number;
        entry_type: string;
        reference_type: string | null;
        reference_id: string | null;
        metadata_json: Json;
        created_at: string;
      }>;
      stripe_events: T<{
        id: string;
        stripe_event_id: string;
        event_type: string;
        processed_at: string | null;
        payload_hash: string | null;
        status: string;
        error_message: string | null;
        created_at: string;
      }>;
      app_events: T<{
        id: string;
        organization_id: string | null;
        user_id: string | null;
        event_name: string;
        batch_id: string | null;
        metadata_json: Json;
        created_at: string;
      }>;
      organization_invitations: T<{
        id: string;
        organization_id: string;
        email: string;
        role: string;
        token: string;
        status: string;
        invited_by: string | null;
        created_at: string;
        accepted_at: string | null;
      }>;
      output_corrections: T<{
        id: string;
        organization_id: string;
        batch_id: string | null;
        product_id: string | null;
        generation_id: string | null;
        preset_id: string | null;
        preset_version_id: string | null;
        field_key: string;
        original_value: string | null;
        corrected_value: string | null;
        reason: string | null;
        applied_to_prompt: boolean;
        applied_at: string | null;
        improvement_version_id: string | null;
        created_by: string | null;
        created_at: string;
      }>;
      // --- Modello configurazione v2 ---
      sectors: T<
        { id: string; key: string; name: string; description: string | null; icon: string | null; is_system: boolean; status: string } & Timestamps
      >;
      organization_sectors: T<{
        id: string;
        organization_id: string;
        sector_id: string;
        is_primary: boolean;
        created_at: string;
      }>;
      categories: T<
        {
          id: string;
          sector_id: string;
          owner_organization_id: string | null;
          parent_category_id: string | null;
          source_category_id: string | null;
          key: string | null;
          name: string;
          description: string | null;
          is_system: boolean;
          status: string;
          archived_at: string | null;
        } & Timestamps
      >;
      organization_categories: T<
        { id: string; organization_id: string; category_id: string; enabled: boolean } & Timestamps
      >;
      attributes: T<
        {
          id: string;
          sector_id: string;
          owner_organization_id: string | null;
          source_attribute_id: string | null;
          key: string | null;
          name: string;
          description: string | null;
          attribute_kind: string;
          data_type: string;
          unit: string | null;
          enum_values_json: Json | null;
          default_extraction_instruction: string | null;
          default_generation_instruction: string | null;
          validation_rules_json: Json;
          normalization_rules_json: Json;
          allowed_sources_json: Json;
          is_system: boolean;
          status: string;
          version: number;
          archived_at: string | null;
        } & Timestamps
      >;
      organization_attributes: T<
        { id: string; organization_id: string; attribute_id: string; enabled: boolean } & Timestamps
      >;
      category_attributes: T<
        {
          id: string;
          category_id: string;
          attribute_id: string;
          is_required: boolean;
          display_order: number;
          extraction_instruction_override: string | null;
          generation_instruction_override: string | null;
          validation_rules_override_json: Json | null;
        } & Timestamps
      >;
      presets: T<
        {
          id: string;
          organization_id: string;
          sector_id: string;
          name: string;
          description: string | null;
          status: string;
          active_version_id: string | null;
          archived_at: string | null;
        } & Timestamps
      >;
      preset_versions: T<{
        id: string;
        preset_id: string;
        version: number;
        name: string | null;
        description: string | null;
        created_by: string | null;
        created_at: string;
        published_at: string | null;
      }>;
      preset_categories: T<{
        id: string;
        preset_version_id: string;
        category_id: string;
        display_order: number;
        enabled: boolean;
        created_at: string;
      }>;
      preset_attributes: T<{
        id: string;
        preset_version_id: string;
        attribute_id: string;
        category_id: string | null;
        is_required: boolean;
        display_order: number;
        extraction_instruction_override: string | null;
        generation_instruction_override: string | null;
        validation_rules_override_json: Json | null;
        enabled: boolean;
        created_at: string;
      }>;
      preset_generated_fields: T<{
        id: string;
        preset_version_id: string;
        field_key: string;
        label: string | null;
        display_order: number;
        enabled: boolean;
        config_json: Json;
        created_at: string;
      }>;
      configuration_conversations: T<
        {
          id: string;
          organization_id: string;
          entity_type: string;
          entity_draft_id: string | null;
          status: string;
          completed_at: string | null;
        } & Timestamps
      >;
      configuration_messages: T<{
        id: string;
        conversation_id: string;
        role: string;
        content: string;
        transcript_source_file_id: string | null;
        tool_calls_json: Json | null;
        created_at: string;
      }>;
      configuration_drafts: T<
        {
          id: string;
          organization_id: string;
          entity_type: string;
          entity_id: string | null;
          draft_data_json: Json;
          status: string;
          created_by: string | null;
          confirmed_at: string | null;
          published_at: string | null;
        } & Timestamps
      >;
    };
    Views: Record<string, never>;
    Functions: {
      is_organization_member: { Args: { org: string }; Returns: boolean };
      is_organization_owner: { Args: { org: string }; Returns: boolean };
      get_credit_balance: { Args: { org: string }; Returns: number };
      grant_welcome_credits: { Args: { org: string; amt?: number }; Returns: undefined };
      reserve_credits: {
        Args: { org: string; amt: number; ref_type: string; ref_id: string | null };
        Returns: boolean;
      };
      release_credits: {
        Args: { org: string; amt: number; ref_type: string; ref_id: string | null };
        Returns: undefined;
      };
      consume_reserved_credit: {
        Args: { org: string; ref_type: string; ref_id: string | null };
        Returns: undefined;
      };
      apply_credit_purchase: {
        Args: { org: string; amt: number; stripe_event: string; price_key: string };
        Returns: undefined;
      };
      create_organization_for_user: {
        Args: { user_id: string; org_name: string; org_slug: string; welcome_amt?: number };
        Returns: string;
      };
      consume_rate_limit: {
        Args: { org: string; act: string; max_per_window: number; window_seconds: number };
        Returns: boolean;
      };
      queue_send: { Args: { msg: Json }; Returns: number };
      queue_read: { Args: { vt: number; qty: number }; Returns: Json };
      queue_delete: { Args: { msg_id: number }; Returns: boolean };
      queue_archive: { Args: { msg_id: number }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
