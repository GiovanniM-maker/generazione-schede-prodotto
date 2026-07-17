'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, Loader2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { createBatchAction, uploadAndParseAction } from '@/lib/actions/batches';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function NewBatchFlow({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function createBatch() {
    setCreating(true);
    setError(null);
    try {
      const res = await createBatchAction({
        organizationId,
        name: name.trim() || 'Nuovo batch',
      });
      setBatchId(res.batchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Creazione batch non riuscita');
    } finally {
      setCreating(false);
    }
  }

  async function upload() {
    if (!batchId || !file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('batchId', batchId);
      fd.set('file', file);
      const preview = await uploadAndParseAction(fd);
      // La ParsePreview non è persistita per-colonna: la passiamo alla pagina
      // di mapping tramite sessionStorage.
      sessionStorage.setItem(`preview:${batchId}`, JSON.stringify(preview));
      router.push(`/app/batches/${batchId}/mapping`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Caricamento o analisi non riusciti',
      );
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {/* Passo 1: nome */}
        <div>
          <Label htmlFor="batch-name">Nome del batch</Label>
          <Input
            id="batch-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Es. Collezione Primavera 2026"
            disabled={!!batchId}
          />
        </div>

        {/* Preset (read-only) */}
        <div>
          <Label>Preset</Label>
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
            <span className="inline-flex h-6 items-center rounded-full bg-brand px-2.5 text-xs font-medium text-white">
              Moda
            </span>
            <span className="text-gray-500">
              Ottimizzato per capi di abbigliamento e accessori.
            </span>
          </div>
        </div>

        {!batchId ? (
          <Button onClick={createBatch} disabled={creating || !name.trim()}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creazione…
              </>
            ) : (
              'Continua'
            )}
          </Button>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="file">File del catalogo (CSV o XLSX)</Label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center transition-colors hover:border-brand-accent hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {file ? (
                  <>
                    <FileSpreadsheet className="h-8 w-8 text-brand-accent" />
                    <span className="text-sm font-medium text-gray-900">
                      {file.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      Clicca per cambiare file
                    </span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-8 w-8 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">
                      Clicca per selezionare un file
                    </span>
                    <span className="text-xs text-gray-500">
                      Formati supportati: .csv, .xlsx
                    </span>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                id="file"
                type="file"
                accept=".csv,.xlsx"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
            </div>

            <Button onClick={upload} disabled={!file || uploading}>
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analisi del file…
                </>
              ) : (
                'Carica e analizza'
              )}
            </Button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
