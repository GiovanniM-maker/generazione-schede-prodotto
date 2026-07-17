import type { TypedClient } from './service-client.js';

// ---------------------------------------------------------------------------
// Helper coda PGMQ via wrapper RPC (SECURITY DEFINER, solo service_role).
// Il messaggio contiene SOLO identificativi, mai l'intero prodotto.
// ---------------------------------------------------------------------------

export interface QueueMessage {
  jobItemId: string;
}

export interface ReadMessage {
  msg_id: number;
  read_ct: number;
  message: QueueMessage;
}

export async function queueSend(client: TypedClient, msg: QueueMessage): Promise<number> {
  const { data, error } = await client.rpc('queue_send', { msg: msg as never });
  if (error) throw new Error(`queue_send: ${error.message}`);
  return data as number;
}

export async function queueRead(
  client: TypedClient,
  visibilityTimeoutSec: number,
  qty: number,
): Promise<ReadMessage[]> {
  const { data, error } = await client.rpc('queue_read', {
    vt: visibilityTimeoutSec,
    qty,
  });
  if (error) throw new Error(`queue_read: ${error.message}`);
  const rows = (data ?? []) as Array<{ msg_id: number; read_ct: number; message: unknown }>;
  return rows.map((r) => ({
    msg_id: Number(r.msg_id),
    read_ct: Number(r.read_ct),
    message: r.message as QueueMessage,
  }));
}

export async function queueDelete(client: TypedClient, msgId: number): Promise<void> {
  const { error } = await client.rpc('queue_delete', { msg_id: msgId });
  if (error) throw new Error(`queue_delete: ${error.message}`);
}

export async function queueArchive(client: TypedClient, msgId: number): Promise<void> {
  const { error } = await client.rpc('queue_archive', { msg_id: msgId });
  if (error) throw new Error(`queue_archive: ${error.message}`);
}
