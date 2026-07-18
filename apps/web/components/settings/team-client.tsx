'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Loader2, Trash2, Copy, Check } from 'lucide-react';
import {
  inviteMember,
  revokeInvite,
  removeMember,
  type TeamMember,
  type TeamInvite,
} from '@/lib/actions/team';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

export function TeamClient({
  members,
  invites,
  isOwner,
}: {
  members: TeamMember[];
  invites: TeamInvite[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'owner'>('member');
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function invite() {
    setError(null);
    setNewLink(null);
    startTransition(async () => {
      const res = await inviteMember({ email, role });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEmail('');
      setNewLink(res.data.link);
      router.refresh();
    });
  }

  function copy(link: string) {
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(link);
        setTimeout(() => setCopied(null), 1500);
      },
      () => {},
    );
  }

  function revoke(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await revokeInvite({ id });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function remove(userId: string) {
    if (!window.confirm('Rimuovere questo membro dall’organizzazione?')) return;
    setError(null);
    startTransition(async () => {
      const res = await removeMember({ userId });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Team</h2>
        <p className="mt-1 text-sm text-gray-500">
          Membri dell’organizzazione e inviti in sospeso.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {isOwner && (
        <Card className="p-5">
          <h3 className="text-base font-semibold text-gray-900">Invita un membro</h3>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="inv-email">Email</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="collega@azienda.it"
              />
            </div>
            <div>
              <Label htmlFor="inv-role">Ruolo</Label>
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'owner')}>
                <option value="member">Membro</option>
                <option value="owner">Proprietario</option>
              </Select>
            </div>
            <Button onClick={invite} disabled={pending || !email.trim()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Invita
            </Button>
          </div>
          {newLink && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-emerald-800">{newLink}</span>
              <Button variant="outline" size="sm" onClick={() => copy(newLink)}>
                {copied === newLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copia link
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400">
            Condividi il link con la persona invitata: dovrà accedere con questa email per
            entrare nell’organizzazione.
          </p>
        </Card>
      )}

      <Card>
        <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">
          Membri ({members.length})
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Email</TH>
              <TH>Ruolo</TH>
              {isOwner && <TH className="text-right">Azioni</TH>}
            </TR>
          </THead>
          <TBody>
            {members.map((m) => (
              <TR key={m.userId}>
                <TD className="text-gray-900">
                  {m.email}
                  {m.isYou && <span className="ml-2 text-xs text-gray-400">(tu)</span>}
                </TD>
                <TD>
                  <Badge tone={m.role === 'owner' ? 'violet' : 'gray'}>
                    {m.role === 'owner' ? 'Proprietario' : 'Membro'}
                  </Badge>
                </TD>
                {isOwner && (
                  <TD className="text-right">
                    {!m.isYou && (
                      <Button variant="ghost" size="sm" onClick={() => remove(m.userId)} disabled={pending}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {invites.length > 0 && (
        <Card>
          <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">
            Inviti in sospeso ({invites.length})
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Email</TH>
                <TH>Ruolo</TH>
                <TH>Link</TH>
                {isOwner && <TH className="text-right">Azioni</TH>}
              </TR>
            </THead>
            <TBody>
              {invites.map((i) => (
                <TR key={i.id}>
                  <TD className="text-gray-900">{i.email}</TD>
                  <TD>
                    <Badge tone={i.role === 'owner' ? 'violet' : 'gray'}>
                      {i.role === 'owner' ? 'Proprietario' : 'Membro'}
                    </Badge>
                  </TD>
                  <TD>
                    <Button variant="ghost" size="sm" onClick={() => copy(i.link)}>
                      {copied === i.link ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      Copia
                    </Button>
                  </TD>
                  {isOwner && (
                    <TD className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => revoke(i.id)} disabled={pending}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
