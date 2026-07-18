'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { exportMyData, deleteAccount } from '@/lib/actions/account';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AccountClient({ email, isOwner }: { email: string; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const res = await exportMyData();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const blob = new Blob([res.data.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setExporting(false);
    }
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteAccount({ confirmation });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/login');
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Account</h2>
        <p className="mt-1 text-sm text-gray-500">Accesso: {email}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="p-5">
        <h3 className="text-base font-semibold text-gray-900">Esporta i tuoi dati</h3>
        <p className="mt-1 text-sm text-gray-500">
          Scarica un file JSON con i dati del tuo account e della tua
          organizzazione (diritto di accesso e portabilità).
        </p>
        <Button className="mt-3" variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Esporta dati (JSON)
        </Button>
      </Card>

      <Card className="border-red-200 p-5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <h3 className="text-base font-semibold text-gray-900">Elimina account</h3>
            <p className="mt-1 text-sm text-gray-500">
              Elimina definitivamente l’account e <strong>tutti i dati</strong>{' '}
              dell’organizzazione (batch, prodotti, schede, configurazione).
              L’operazione è irreversibile.
            </p>
          </div>
        </div>

        {isOwner ? (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="del-confirm">
                Digita <span className="font-mono font-semibold">ELIMINA</span> per confermare
              </Label>
              <Input
                id="del-confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="ELIMINA"
                className="mt-1 max-w-xs"
              />
            </div>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={pending || confirmation.trim().toUpperCase() !== 'ELIMINA'}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Elimina definitivamente
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            Solo il proprietario dell’organizzazione può eliminarla.
          </p>
        )}
      </Card>
    </div>
  );
}
