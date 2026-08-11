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
  const [mancanoDati, setMancanoDati] = useState(false);

  async function buy() {
    setLoading(true);
    setError(null);
    setMancanoDati(false);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packKey }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        missingBilling?: boolean;
      };
      if (!res.ok || !body.url) {
        // Un errore che non dice dove andare a risolverlo è un vicolo cieco:
        // qui la causa è nota e il posto dove sistemarla è a due righe di
        // distanza sulla stessa pagina.
        if (body.missingBilling) setMancanoDati(true);
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
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
          {mancanoDati && (
            <>
              {' '}
              <a href="#dati-fattura" className="font-medium underline">
                Compila i dati per la fattura
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
