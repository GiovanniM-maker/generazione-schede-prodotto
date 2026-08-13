import { describe, expect, it } from 'vitest';
import { consegna, frasiDiConsegna, type RigaDaRiepilogare } from '../riepilogo-consegna';
import type { CompletenessStatus } from '../completeness';

// ---------------------------------------------------------------------------
// Il conto di cosa è stato consegnato.
//
// Sembra aritmetica, e per metà lo è. L'altra metà sono decisioni che si
// possono sbagliare in silenzio: contare come «generata» una scheda fallita,
// dire «0 fallite» a chi non ne ha nessuna, o riassumere un batch vuoto con un
// numero invece che tacendo. Nessuna di queste rompe niente — dicono solo una
// cosa falsa in un posto in cui si guarda.
// ---------------------------------------------------------------------------

const riga = (
  status: string,
  completeness: CompletenessStatus | null = null,
  jobFailed = false,
): RigaDaRiepilogare => ({
  status,
  jobFailed,
  completeness: completeness ? { status: completeness } : null,
});

describe('il conto', () => {
  it('una scheda fallita non è una scheda generata', () => {
    // È l'errore che conta: un batch mezzo fallito che si annuncia come
    // riuscito è esattamente il difetto già corretto altrove (§3.6), e questo
    // è il posto da cui potrebbe rientrare.
    const c = consegna([
      riga('generated', 'complete'),
      riga('failed'),
      riga('generated', 'partial', true),
    ]);
    expect(c.generate).toBe(1);
    expect(c.fallite).toBe(2);
    expect(c.complete).toBe(1);
  });

  it('un prodotto che non è ancora stato elaborato non conta né di qua né di là', () => {
    const c = consegna([riga('pending'), riga('generated', 'complete')]);
    expect(c).toMatchObject({ generate: 1, fallite: 0, prodotti: 2 });
  });

  it('«da guardare» raccoglie tutto quello che non è completo', () => {
    const c = consegna([
      riga('generated', 'partial'),
      riga('generated', 'insufficient'),
      riga('generated', 'needs_review'),
      riga('generated', 'blocked'),
      riga('generated', 'complete'),
    ]);
    expect(c.daGuardare).toBe(4);
    expect(c.complete).toBe(1);
  });
});

describe('la frase', () => {
  it('tace quando non c’è ancora niente da dire', () => {
    // Un batch senza nemmeno una scheda non ha una consegna da riassumere.
    // «0 schede generate» è peggio del silenzio: mette un fallimento dove c'è
    // solo un lavoro non ancora cominciato.
    expect(frasiDiConsegna(consegna([]))).toBeNull();
    expect(frasiDiConsegna(consegna([riga('pending'), riga('pending')]))).toBeNull();
  });

  it('non nomina le categorie a zero', () => {
    // «0 fallite» mette in testa un'idea di fallimento che non c'è.
    const f = frasiDiConsegna(consegna([riga('generated', 'complete'), riga('generated', 'complete')]));
    expect(f).toBe('2 schede generate · 2 complete');
    expect(f).not.toMatch(/0 /);
  });

  it('ma le fallite le nomina sempre, anche una sola', () => {
    // È l'unica parte che chiede di fare qualcosa: tacerla per «pulizia» vuol
    // dire nasconderla.
    const f = frasiDiConsegna(consegna([riga('generated', 'complete'), riga('failed')]));
    expect(f).toContain('1 fallita');
  });

  it('dice «su quanti prodotti» solo quando i due numeri sono diversi', () => {
    // «3 schede generate su 3 prodotti» è rumore; «3 su 12» è un'informazione.
    expect(frasiDiConsegna(consegna([riga('generated'), riga('generated'), riga('generated')]))).toBe(
      '3 schede generate',
    );
    expect(frasiDiConsegna(consegna([riga('generated'), riga('pending'), riga('pending')]))).toBe(
      '1 scheda generata su 3 prodotti',
    );
  });

  it('l’italiano regge anche al singolare', () => {
    const f = frasiDiConsegna(consegna([riga('generated', 'complete')]));
    expect(f).toBe('1 scheda generata · 1 completa');
  });
});
