import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex items-center justify-center py-24 text-gray-400">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="ml-2 text-sm">Caricamento…</span>
    </div>
  );
}
