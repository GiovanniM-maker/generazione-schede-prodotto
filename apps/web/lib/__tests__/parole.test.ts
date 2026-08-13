import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { senzaCommenti } from './senza-commenti.js';

// ---------------------------------------------------------------------------
// Le parole a schermo.
//
// Sono la parte del prodotto che si legge davvero, e sono quella che scivola
// per prima: un'etichetta che promette una pagina che non esiste, un contatore
// che chiama «duplicati» il caso normale, una parola inglese in mezzo a una
// frase italiana. Nessuna di queste rompe niente — e proprio per questo
// nessuno le corregge.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const leggi = (rel: string) => readFileSync(join(RADICE, rel), 'utf8');

function tsx(dir: string): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  for (const e of readdirSync(join(RADICE, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsx(rel));
    else if (e.name.endsWith('.tsx')) out.push({ path: rel, src: leggi(rel) });
  }
  return out;
}

const sorgenti = [...tsx('components'), ...tsx('app')];

describe('un’etichetta non promette una pagina che non esiste', () => {
  it('nessun «Registrati» che porta su «Accedi»', () => {
    // `/signup` risponde 404 e nessun collegamento ci punta: non era un
    // collegamento rotto, era un'etichetta che prometteva una pagina che non
    // c'è. Il percorso è uno solo, e il primo accesso crea l'account.
    const colpevoli = sorgenti.filter((f) => />Registrati</.test(f.src)).map((f) => f.path);
    expect(colpevoli).toEqual([]);
  });

  it('la pagina di accesso dice che serve anche a registrarsi', () => {
    expect(leggi('app/login/page.tsx')).toMatch(/Accedi o registrati/);
  });
});

describe('i contatori dicono cosa è successo', () => {
  it('«da rivedere» non c’è più: quelle righe sono scartate', () => {
    // Promettevano una revisione che non esiste da nessuna parte.
    const colpevoli = sorgenti.filter((f) => /\{importSummary\.invalid\} da rivedere/.test(f.src));
    expect(colpevoli.map((f) => f.path)).toEqual([]);
    expect(leggi('components/batch/wizard.tsx')).toMatch(/righe scartate/);
  });

  it('e si può vedere QUALI righe sono cadute, con il perché', () => {
    // Prima ne restava solo il numero: l'unico modo di scoprire quali era
    // confrontare a mano il file con il catalogo importato.
    const azioni = readFileSync(join(RADICE, 'lib/actions/batch-wizard.ts'), 'utf8');
    expect(azioni).toMatch(/scartate: RigaScartata\[\]/);
    for (const motivo of ['codice non valido', 'codice ripetuto nel file', 'dati insufficienti']) {
      expect(azioni, motivo).toContain(`'${motivo}'`);
    }
    expect(leggi('components/batch/wizard.tsx')).toMatch(/Quali righe sono state scartate/);
  });

  it('lo stesso file caricato due volte non si chiama «SKU duplicati»', () => {
    // Era falso e allarmava per una cosa che va benissimo: due foto con lo
    // stesso codice sono il caso NORMALE — fronte, retro, etichetta — e il
    // sistema le raggruppa apposta.
    const banner = leggi('components/import-issues-banner.tsx');
    expect(banner).not.toMatch(/label: 'SKU duplicati'/);
    expect(banner).toMatch(/Stesso file caricato due volte/);
  });
});

describe('il conto dei passi non cambia strada facendo', () => {
  it('il totale si dice solo quando si conosce', () => {
    // Con un Excel i passi sono due in più: finché la fonte non è scelta il
    // totale non si sa, e prometterne uno vuol dire passare da «di 9» a «di 11»
    // senza aver fatto niente di sbagliato.
    const wizard = leggi('components/batch/wizard.tsx');
    expect(wizard).toMatch(/totaleNoto \? ` di \$\{steps\.length\}` : ''/);
    expect(wizard).toMatch(/totaleNoto=\{sourceMode !== null\}/);
  });
});

describe('l’aiuto non copre il comando principale', () => {
  it('su telefono il pulsante flottante non c’è', () => {
    // La barra dei comandi è `sticky`: con poco contenuto si ferma a metà
    // schermo, proprio dove galleggiava «Serve aiuto?». Misurato: si
    // sovrapponevano a «Crea e continua».
    const guida = leggi('components/onboarding/wizard-guide.tsx');
    expect(guida).toMatch(/hidden items-center gap-2 rounded-full sm:flex/);
  });

  it('e nella barra c’è il suo comando', () => {
    expect(leggi('components/batch/wizard.tsx')).toMatch(/aria-label="Apri la guida"/);
  });
});

describe('una parola per una cosa', () => {
  it('niente «Custom» in un prodotto italiano', () => {
    const colpevoli = sorgenti
      .filter((f) => !f.path.endsWith('badge.tsx'))
      .filter((f) => />Custom(\s|<|\{)/.test(f.src))
      .map((f) => f.path);
    expect(colpevoli).toEqual([]);
  });

  it('gli indirizzi sono in inglese, tutti', () => {
    // `/storico` era l'unico in italiano fra sette in inglese. Una sola
    // eccezione non è una convenzione: è un inciampo.
    expect(existsSync(join(RADICE, 'app/app/settings/activity/page.tsx'))).toBe(true);
    expect(leggi('components/settings/settings-nav.tsx')).toMatch(/'\/app\/settings\/activity'/);
  });

  it('il vecchio indirizzo continua a funzionare', () => {
    // I segnalibri di chi lo usava non si rompono per una questione di
    // coerenza nostra.
    expect(leggi('app/app/settings/storico/page.tsx')).toMatch(
      /permanentRedirect\('\/app\/settings\/activity'\)/,
    );
  });
});

describe('il gergo interno non arriva a chi paga', () => {
  // Premendo «Acquista» con Stripe non configurato, al cliente compariva
  // «Prezzo Stripe non configurato»: il nome di una nostra variabile
  // d'ambiente, davanti a una persona che stava per pagare. Non è un errore
  // che può correggere, e leggerlo lo lascia a chiedersi se i suoi soldi
  // siano al sicuro.
  //
  // Il test guarda il file del checkout perché è lì che il gergo si infila:
  // ogni ramo di errore nasce da una condizione tecnica, e la via più corta è
  // sempre scrivere la condizione.
  const checkout = leggi('app/api/stripe/checkout/route.ts');

  it('nessun messaggio nomina i nostri pezzi', () => {
    // I nomi delle cose che il cliente non ha, non gestisce e non può
    // aggiustare.
    const gergo = /error:\s*['"`][^'"`]*\b(Stripe|price_?[Ii]d|env|variabile d.ambiente|packKey|RPC|Supabase)\b/;
    expect(checkout).not.toMatch(gergo);
  });

  it('quando il guasto è nostro, si dice che non c’è stato addebito', () => {
    // È la sola cosa che una persona vuole sapere quando un pagamento non
    // parte.
    expect(checkout).toMatch(/Non ti è stato addebitato niente/);
  });

  it('il motivo vero però resta scritto, per noi', () => {
    // Tradurre non vuol dire perdere: senza il motivo nei log, «non riesco a
    // comprare» diventa irrisolvibile.
    expect(checkout).toMatch(/console\.error\(`\[acquisto\]/);
  });

  it('quello che il cliente PUÒ correggere continua a dirglielo', () => {
    // I dati per la fattura sono suoi, e il messaggio deve restare specifico:
    // annegarlo nel messaggio generico sarebbe il difetto opposto.
    expect(checkout).toMatch(/ragione sociale, indirizzo, partita IVA/);
    expect(checkout).toMatch(/Solo il proprietario dell'organizzazione/);
  });
});

describe('l’accesso non parla la lingua del fornitore', () => {
  it('nessun errore del fornitore arriva a schermo così com’è', () => {
    // Era `return { error: error.message }`, sull'unica porta d'ingresso del
    // prodotto.
    const auth = leggi('lib/actions/auth.ts');
    expect(auth).not.toMatch(/error:\s*error\.message/);
    expect(auth).not.toMatch(/\$\{\s*err instanceof Error \? err\.message/);
    expect(auth).toMatch(/from '@\/lib\/errori-accesso'/);
  });

  it('il nome delle variabili d’ambiente resta fra noi', () => {
    // «Imposta NEXT_PUBLIC_SUPABASE_URL e ... nelle variabili d'ambiente e
    // riprova» era il messaggio mostrato a chi voleva solo entrare.
    const auth = leggi('lib/actions/auth.ts');
    const messaggi = [...auth.matchAll(/error:\s*'([^']+)'/g)].map((m) => m[1]!);
    for (const m of messaggi) {
      expect(m, `«${m}» nomina una variabile d’ambiente`).not.toMatch(/[A-Z_]{6,}/);
    }
  });
});

describe('un segnaposto suggerisce, non finge', () => {
  it('nessun campo mostra come segnaposto la parola che chiede', () => {
    // Il campo di conferma dell'eliminazione aveva `placeholder="ELIMINA"`,
    // cioè esattamente la stringa richiesta: sembrava già compilato, e il
    // pulsante sembrava disattivato senza motivo. La parola da scrivere era
    // già in chiaro nell'etichetta sopra.
    const account = senzaCommenti(leggi('components/settings/account-client.tsx'));
    expect(account).toMatch(/Digita <span[^>]*>ELIMINA<\/span>/);
    expect(account).not.toMatch(/placeholder="ELIMINA"/);
  });

  it('il campo del codice non mostra un codice finto', () => {
    // `placeholder="123456"` con `tracking-[0.4em]` era indistinguibile da un
    // codice digitato — e dopo un tentativo sbagliato il campo si svuota,
    // quindi si rileggeva il segnaposto come il proprio errore.
    const login = senzaCommenti(leggi('app/login/page.tsx'));
    expect(login).not.toMatch(/placeholder="\d{6}"/);
    expect(login).not.toMatch(/placeholder="1 2 3/);
  });
});

describe('i tipi di dato si leggono in italiano', () => {
  it('nessuna schermata stampa il valore grezzo', () => {
    // Si leggeva `long_text`, `multi_enum`, `measurement` nella colonna «Dato»,
    // nel dettaglio di preset e categorie, nella scheda di un attributo — e
    // nel menu di creazione era **l'unica cosa scritta**: si sceglieva un tipo
    // leggendo un identificatore di database.
    const colpevoli = sorgenti
      .filter((f) => /\{\s*(a|attr|data)\.dataType\s*\}/.test(f.src))
      .map((f) => f.path);
    expect(colpevoli, 'passa da `etichettaTipoDato`').toEqual([]);
  });

  it('l’elenco dei tipi e le loro etichette vengono dallo stesso posto', () => {
    // Erano tre: una lista grezza per la tendina, e due mappe che dicevano la
    // stessa cosa in modo diverso («testo lungo» contro «Testo lungo»). Con
    // due sorgenti separate, la tendina può guadagnare un tipo che nessuna
    // etichetta conosce, e nessuno se ne accorge.
    const attributi = leggi('components/settings/attributes-client.tsx');
    expect(attributi).not.toMatch(/const DATA_TYPES = \[/);
    expect(attributi).toMatch(/TIPI_DATO/);
    for (const f of ['components/settings/preset-copilot-panel.tsx', 'components/onboarding-stepper.tsx']) {
      expect(leggi(f), `${f} ha ancora una mappa sua`).not.toMatch(/const (TYPE_LABEL|DATA_TYPE_LABELS)/);
    }
  });
});

describe('quello che manca a noi non si dice al cliente', () => {
  it('il piede non annuncia una configurazione mancante', () => {
    // Diceva «Contatto di assistenza non ancora configurato» in fondo a ogni
    // schermata. Era vero — meglio del silenzio, meglio di un `mailto:` morto —
    // ma tre revisioni su sei l'hanno classificato come guasto del prodotto. È
    // un messaggio nostro, su una cosa che il cliente non può sistemare.
    expect(senzaCommenti(leggi('components/app-footer.tsx'))).not.toMatch(/non ancora configurat/i);
  });

  it('lo dice invece a chi può sistemarla', () => {
    // Togliere il messaggio senza spostarlo sarebbe stato nasconderlo.
    const admin = leggi('app/app/admin/page.tsx');
    expect(admin).toMatch(/Da configurare/);
    expect(admin).toMatch(/SUPPORT_EMAIL/);
  });
});

describe('i documenti legali descrivono il prodotto che c’è', () => {
  it('i termini non promettono un accesso «tramite link»', () => {
    // Il login manda un CODICE a sei cifre. I termini descrivevano l'accesso
    // «tramite link via email», che era vero in una versione precedente: un
    // documento legale che descrive un prodotto diverso da quello in uso è
    // sbagliato in un modo che nessun test di interfaccia può vedere.
    const termini = senzaCommenti(leggi('app/termini/page.tsx'));
    expect(termini).not.toMatch(/tramite link via email/i);
    expect(termini).toMatch(/codice a sei cifre/i);
  });
});

describe('il wizard non lascia saltare la verifica', () => {
  it('«Continua» si spegne anche mentre il passo 9 importa', () => {
    // Il blocco era ai passi 2, 6 e 8 — non al 9, che è l'unico che SCRIVE i
    // prodotti. Durante l'importazione la pagina è vuota e «Continua» era
    // l'unico oggetto colorato dello schermo: un clic e si arrivava al
    // campione senza aver mai guardato i dati importati.
    const wizard = senzaCommenti(leggi('components/batch/wizard.tsx'));
    for (const passo of [2, 6, 8, 9]) {
      expect(wizard, `passo ${passo} senza blocco`).toContain(
        `setPassoInCaricamento(${passo})`,
      );
    }
  });
});

describe('le sovrapposizioni si impilano in un ordine solo', () => {
  it('il banner cookie sta sotto tutto quello che si apre sopra la pagina', () => {
    // A `z-50` copriva modali (z-50 rese prima), cassetti dei risultati (z-40)
    // e del preset (z-40). È arredamento di pagina: deve stare sotto.
    const banner = senzaCommenti(leggi('components/cookie-banner.tsx'));
    const quota = banner.match(/fixed inset-x-0 bottom-0 z-(\d+)/);
    expect(quota, 'quota del banner non trovata').not.toBeNull();
    expect(Number(quota![1]), 'il banner sta alla quota delle sovrapposizioni').toBeLessThan(30);
  });
});
