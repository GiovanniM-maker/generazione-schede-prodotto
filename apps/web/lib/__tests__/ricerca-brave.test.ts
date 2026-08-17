import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroreRicerca, RicercaBrave } from '../ricerca-brave';

// ---------------------------------------------------------------------------
// L'adattatore verso Brave.
//
// La distinzione che queste prove difendono, e che è la ragione per cui questo
// file esiste: **un errore del servizio non è un prodotto non trovato**. «Ho
// cercato e non c'è» si scrive nella scheda; «non sono riuscito a cercare» si
// riprova. Confonderle vorrebbe dire archiviare come inesistenti tutti i
// prodotti cercati durante un guasto — e senza che nessuno se ne accorga,
// perché il risultato assomiglia a un import riuscito.
// ---------------------------------------------------------------------------

const SUBITO = { attesa: () => Promise.resolve(), tentativi: 3 };
const RICHIESTA = { codice: 'SED-AUR-01', marca: 'Ferrini', domini: [], limite: 10 };

const RISPOSTA_BUONA = {
  web: {
    results: [
      { url: 'https://ferrini.it/p/sed-aur-01', title: 'Sedia Aurora', description: 'SED-AUR-01' },
    ],
  },
};

function rispostaFinta(status: number, corpo: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corpo),
  } as unknown as Response;
}

let fetchFinto: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchFinto = vi.fn();
  vi.stubGlobal('fetch', fetchFinto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RicercaBrave — la chiamata', () => {
  it('manda la chiave nell’intestazione, non nell’indirizzo', async () => {
    // Nell'indirizzo finirebbe nei log del servizio e in quelli di ogni proxy
    // in mezzo.
    fetchFinto.mockResolvedValue(rispostaFinta(200, RISPOSTA_BUONA));
    await new RicercaBrave('chiave-segreta', SUBITO).cerca(RICHIESTA);

    const [url, opzioni] = fetchFinto.mock.calls[0]!;
    expect(String(url)).not.toContain('chiave-segreta');
    expect((opzioni as RequestInit).headers).toMatchObject({ 'X-Subscription-Token': 'chiave-segreta' });
  });

  it('mette in query il codice fra virgolette e la marca', async () => {
    fetchFinto.mockResolvedValue(rispostaFinta(200, RISPOSTA_BUONA));
    await new RicercaBrave('k', SUBITO).cerca(RICHIESTA);
    const q = new URL(String(fetchFinto.mock.calls[0]![0])).searchParams.get('q');
    expect(q).toBe('"SED-AUR-01" Ferrini');
  });

  it('non chiama affatto se non c’è un codice da cercare', async () => {
    // Una chiamata senza codice non può trovare il prodotto e si paga uguale.
    const r = await new RicercaBrave('k', SUBITO).cerca({ ...RICHIESTA, codice: '  ' });
    expect(r).toEqual([]);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('non chiede più risultati del tetto', async () => {
    fetchFinto.mockResolvedValue(rispostaFinta(200, RISPOSTA_BUONA));
    await new RicercaBrave('k', SUBITO).cerca({ ...RICHIESTA, limite: 999 });
    const count = new URL(String(fetchFinto.mock.calls[0]![0])).searchParams.get('count');
    expect(Number(count)).toBeLessThanOrEqual(20);
  });

  it('restituisce i risultati letti dalla risposta', async () => {
    fetchFinto.mockResolvedValue(rispostaFinta(200, RISPOSTA_BUONA));
    const r = await new RicercaBrave('k', SUBITO).cerca(RICHIESTA);
    expect(r).toHaveLength(1);
    expect(r[0]!.dominio).toBe('ferrini.it');
  });
});

describe('RicercaBrave — quando il servizio risponde male', () => {
  it('una chiave sbagliata non viene ritentata', async () => {
    // 401 è definitivo: ritentare non cambia niente e consuma quota.
    fetchFinto.mockResolvedValue(rispostaFinta(401));
    await expect(new RicercaBrave('k', SUBITO).cerca(RICHIESTA)).rejects.toThrow(ErroreRicerca);
    expect(fetchFinto).toHaveBeenCalledTimes(1);
  });

  it('la quota esaurita viene ritentata, e poi dichiarata ritentabile', async () => {
    fetchFinto.mockResolvedValue(rispostaFinta(429));
    const errore = await new RicercaBrave('k', SUBITO).cerca(RICHIESTA).catch((e: unknown) => e);
    expect(fetchFinto).toHaveBeenCalledTimes(3);
    expect(errore).toBeInstanceOf(ErroreRicerca);
    expect((errore as ErroreRicerca).ritentabile).toBe(true);
  });

  it('un guasto del servizio viene ritentato', async () => {
    fetchFinto.mockResolvedValue(rispostaFinta(503));
    await expect(new RicercaBrave('k', SUBITO).cerca(RICHIESTA)).rejects.toThrow(ErroreRicerca);
    expect(fetchFinto).toHaveBeenCalledTimes(3);
  });

  it('se il secondo tentativo riesce, il risultato è quello', async () => {
    fetchFinto
      .mockResolvedValueOnce(rispostaFinta(503))
      .mockResolvedValueOnce(rispostaFinta(200, RISPOSTA_BUONA));
    const r = await new RicercaBrave('k', SUBITO).cerca(RICHIESTA);
    expect(r).toHaveLength(1);
    expect(fetchFinto).toHaveBeenCalledTimes(2);
  });

  it('la rete che cade è un errore, non una lista vuota', async () => {
    // È la prova che dà il senso a tutto il file: se qui tornasse `[]`, ogni
    // prodotto cercato durante un guasto verrebbe archiviato come inesistente,
    // e l'import sembrerebbe riuscito.
    fetchFinto.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(new RicercaBrave('k', SUBITO).cerca(RICHIESTA)).rejects.toThrow(ErroreRicerca);
  });

  it('una risposta buona ma senza risultati è una lista vuota, non un errore', async () => {
    // L'altra metà della stessa distinzione: qui il servizio ha funzionato, e
    // «non c'è» è una risposta.
    fetchFinto.mockResolvedValue(rispostaFinta(200, { web: { results: [] } }));
    await expect(new RicercaBrave('k', SUBITO).cerca(RICHIESTA)).resolves.toEqual([]);
  });
});
