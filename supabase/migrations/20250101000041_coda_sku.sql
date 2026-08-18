-- La coda a scaglioni della fonte «Lista SKU».
--
-- Un catalogo da cinquecento codici non entra in una richiesta sola: prima il
-- limite era venticinque per chiamata, e il resto della lista veniva
-- semplicemente tagliato. Da qui in avanti il registro non è più solo il
-- resoconto di quello che è successo — è la coda stessa: le righe ci entrano
-- prima di essere cercate, e ogni giro ne lavora quante ne stanno nel tempo che
-- ha. È anche il motivo per cui una lavorazione interrotta si riprende: lo
-- stato non sta nel browser di chi l'ha lanciata, sta qui.

-- L'ambito con cui è stata fatta la ricerca.
--
-- Serve alla cache, e non è un di più. Un «non trovato» ottenuto guardando solo
-- fornitorex.it non dice niente su tutto il resto del web: riusarlo per una
-- ricerca aperta vorrebbe dire rispondere «non c'è» a una domanda che non è mai
-- stata fatta. Senza questa colonna non si può distinguere il caso.
alter table sku_resolutions add column if not exists ambito text[] not null default '{}';

-- Quante volte si è provato. Un errore non è un «non trovato» e si riprova; ma
-- non all'infinito, o la lavorazione non finisce mai e non lo dice a nessuno.
alter table sku_resolutions add column if not exists tentativi integer not null default 0;

-- Se questa riga è stata ripresa da una ricerca già fatta invece che cercata di
-- nuovo. È il numero che si mostra a chi rilancia la stessa lista.
alter table sku_resolutions add column if not exists da_cache boolean not null default false;

-- La lettura della cache attraversa le lavorazioni: stessa organizzazione,
-- stesso codice, stessa marca, la più recente. L'indice unico che c'è già
-- comprende il batch, quindi non serve a questa domanda.
create index if not exists sku_resolutions_cache_lookup_idx
  on sku_resolutions(organization_id, codice_normalizzato, marca_normalizzata, aggiornato_il desc);

-- La lettura della coda: le righe di questa lavorazione ancora da fare.
create index if not exists sku_resolutions_coda_idx
  on sku_resolutions(batch_id, esito);

comment on column sku_resolutions.ambito is
  'I domini a cui era limitata la ricerca. Vuoto = tutto il web. Serve a non '
  'riusare un «non trovato» ristretto come se valesse ovunque.';
comment on column sku_resolutions.tentativi is
  'Tentativi falliti di fila. Oltre il limite la riga smette di essere ripresa.';
