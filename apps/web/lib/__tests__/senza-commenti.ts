// ---------------------------------------------------------------------------
// Leggere il prodotto, non la spiegazione del prodotto.
//
// È un errore che ho commesso quattro volte in un pomeriggio, e sempre allo
// stesso modo: correggo un difetto, scrivo sopra il codice un commento che
// racconta com'era prima — «diceva `placeholder="ELIMINA"`», «diceva
// "Prossimamente"» — e poi il test che deve verificare la correzione trova
// quella frase **dentro il commento** e fallisce. Oppure, peggio, un test
// scritto al contrario la trova e passa: allora la correzione può essere
// annullata senza che niente diventi rosso, perché a tenere in piedi il test è
// il commento.
//
// Un test che legge la spiegazione invece del prodotto è un test che si dà
// ragione da solo. Sta qui, in un posto solo, perché serve a tre file e la
// quarta copia sarebbe arrivata da sé.
//
// Toglie i commenti JSX `{/* … */}` e quelli di riga `//`. I blocchi `/* … */`
// fuori dal JSX restano: contengono raramente frasi dell'interfaccia, e
// toglierli richiederebbe distinguere un commento da una stringa che ne
// contiene uno — cioè un parser, per un guadagno che non c'è.
// ---------------------------------------------------------------------------

export function senzaCommenti(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}
