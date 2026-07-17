import { createServer } from 'node:http';
import { queueRead, queueDelete, type ReadMessage } from '@app/database';
import { runProductGeneration, handleJobFailure, type GenerationContext } from '@app/pipeline';
import { buildContext, type WorkerContext } from './context.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Worker: consuma la coda "generation_jobs", elabora i job item con
// concorrenza configurabile, retry con backoff (via visibility timeout),
// idempotenza e graceful shutdown.
// ---------------------------------------------------------------------------

let shuttingDown = false;
let inFlight = 0;

async function processMessage(ctx: WorkerContext, msg: ReadMessage): Promise<void> {
  const genCtx: GenerationContext = {
    client: ctx.client,
    providers: ctx.providers,
    env: ctx.env,
  };
  const jobItemId = msg.message.jobItemId;
  let succeeded = false;
  try {
    const result = await runProductGeneration(genCtx, jobItemId);
    succeeded = true;
    logger.info('job elaborato', { jobItemId, outcome: result.outcome, msgId: msg.msg_id });
  } catch (err) {
    const decision = await handleJobFailure(
      ctx.client,
      jobItemId,
      err,
      ctx.env.MAX_JOB_ATTEMPTS,
    );
    if (decision.retry) {
      // Non elimina il messaggio: riapparirà dopo il visibility timeout (backoff).
      logger.warn('job ritentabile, in attesa di re-visibilità', {
        jobItemId,
        code: decision.code,
      });
    } else {
      // Fallimento definitivo: rimuovi il messaggio, credito già rimborsato.
      succeeded = true; // rimuovi comunque il messaggio (job in stato terminale)
      logger.error('job fallito definitivamente', { jobItemId, code: decision.code });
    }
  }
  // La rimozione dal messaggio è FUORI dal try: un errore di queueDelete dopo un
  // job riuscito non deve far scattare handleJobFailure (rimborso errato).
  if (succeeded) {
    try {
      await queueDelete(ctx.client, msg.msg_id);
    } catch (delErr) {
      logger.warn('queueDelete fallita (il messaggio riapparirà, il job è idempotente)', {
        jobItemId,
        error: delErr instanceof Error ? delErr.message : String(delErr),
      });
    }
  }
}

async function pollOnce(ctx: WorkerContext): Promise<number> {
  const messages = await queueRead(
    ctx.client,
    ctx.env.WORKER_VISIBILITY_TIMEOUT_SECONDS,
    ctx.env.WORKER_CONCURRENCY,
  );
  if (messages.length === 0) return 0;
  inFlight += messages.length;
  await Promise.all(
    messages.map((m) =>
      processMessage(ctx, m).finally(() => {
        inFlight -= 1;
      }),
    ),
  );
  return messages.length;
}

function startHealthServer(port: number): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(shuttingDown ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: shuttingDown ? 'draining' : 'ok', inFlight }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => logger.info('health server in ascolto', { port }));
  return server;
}

async function main(): Promise<void> {
  const ctx = buildContext();
  logger.info('worker avviato', {
    concurrency: ctx.env.WORKER_CONCURRENCY,
    pollIntervalMs: ctx.env.WORKER_POLL_INTERVAL_MS,
    mockAi: ctx.env.ENABLE_MOCK_AI,
  });

  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 8080);
  const healthServer = startHealthServer(healthPort);

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown richiesto, drenaggio in corso', { signal, inFlight });
    const deadline = Date.now() + 30_000;
    const timer = setInterval(() => {
      if (inFlight <= 0 || Date.now() > deadline) {
        clearInterval(timer);
        healthServer.close();
        logger.info('worker terminato');
        process.exit(0);
      }
    }, 500);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Loop principale.
  while (!shuttingDown) {
    try {
      const n = await pollOnce(ctx);
      if (n === 0) {
        await sleep(ctx.env.WORKER_POLL_INTERVAL_MS);
      }
    } catch (err) {
      logger.error('errore nel loop di polling', {
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(ctx.env.WORKER_POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  logger.error('errore fatale del worker', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
