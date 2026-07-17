'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PurchaseButton({
  packKey,
  label = 'Acquista',
  variant = 'primary',
}: {
  packKey: string;
  label?: string;
  variant?: 'primary' | 'outline';
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packKey }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? 'Acquisto non riuscito');
      }
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" variant={variant} onClick={buy} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
