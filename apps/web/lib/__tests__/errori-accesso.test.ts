import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messaggioAccesso } from '../errori-accesso.js';

// ---------------------------------------------------------------------------
// L'unica porta d'ingresso del prodotto parlava inglese.
//
// `signInWithOtp` restituiva l'errore del fornitore così com'era, e in mezzo a
// una pagina curata in italiano si leggeva `Email address "..." is invalid`
// oppure `email rate limit exceeded`. Il secondo è il caso peggiore: non è un
// guasto, è «riprova fra un minuto» — cioè un'informazione utile, detta in modo
// che nessuno la usi.
//
// Due proprietà da tenere ferme, e la seconda è quella che si perde per prima:
// tradurre i casi noti è facile, non far scappare il testo grezzo nel caso
// ignoto è la parte che si dimentica.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Il modulo scrive l'originale nei log: qui si zittisce, ma si controlla
  // anche che ci finisca davvero.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gli errori dell’accesso parlano italiano', () => {
  it('il limite di invii diventa un consiglio, non un verdetto', () => {
    const m = messaggioAccesso({ code: 'over_email_send_rate_limit' }, 'prova');
    expect(m).toMatch(/aspetta un minuto/i);
    expect(m).not.toMatch(/rate limit/i);
  });

  it('riconosce il caso anche quando arriva solo il messaggio del fornitore', () => {
    // Il `code` è stabile, il messaggio no: se il fornitore smette di mandare
    // il codice, la traduzione non deve sparire con lui.
    const m = messaggioAccesso({ message: 'email rate limit exceeded' }, 'prova');
    expect(m).toMatch(/aspetta un minuto/i);
  });

  it('un indirizzo non valido lo dice, senza ripetere l’indirizzo in inglese', () => {
    const m = messaggioAccesso(
      { message: 'Email address "mario@" is invalid' },
      'prova',
    );
    expect(m).toMatch(/non sembra valido/i);
    expect(m).not.toContain('mario@');
  });

  it('un errore mai visto non fa uscire il testo grezzo', () => {
    // È la proprietà che regge tutto il resto: qualunque cosa arrivi, a
    // schermo va una frase nostra.
    const m = messaggioAccesso(
      { code: 'qualcosa_di_nuovo', message: 'Postgres said: relation "x" does not exist' },
      'prova',
    );
    expect(m).not.toContain('Postgres');
    expect(m).not.toContain('relation');
    expect(m).toMatch(/riprova fra qualche minuto/i);
  });

  it('nessuna frase esce in inglese', () => {
    const casi = [
      { code: 'over_email_send_rate_limit' },
      { code: 'email_address_invalid' },
      { code: 'otp_expired' },
      { code: 'user_banned' },
      { message: 'For security purposes, you can only request this after 51 seconds' },
      { message: 'Signups not allowed for otp' },
      { message: 'boh' },
      {},
    ];
    // Parole che in italiano non compaiono mai, e che invece comparivano tutte
    // in quello che il fornitore restituiva.
    const spie = /\b(invalid|exceeded|rate limit|not allowed|failed|expired|address)\b/i;
    for (const c of casi) {
      expect(messaggioAccesso(c, 'prova'), JSON.stringify(c)).not.toMatch(spie);
    }
  });

  it('l’originale non si perde: finisce nei log', () => {
    // Senza questo, «non riesco a entrare» resta senza risposta: a schermo c'è
    // una frase generica, e da nessuna parte è scritto cosa fosse.
    messaggioAccesso({ code: 'boh', message: 'qualcosa di preciso' }, 'invio codice');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('qualcosa di preciso'),
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('invio codice'));
  });
});
