// Structured logging minimale (JSON su stdout). Nessun contenuto completo né
// segreti/API key nei log.

type Level = 'info' | 'warn' | 'error';

function log(level: Level, message: string, meta: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (m: string, meta?: Record<string, unknown>) => log('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log('error', m, meta),
};
