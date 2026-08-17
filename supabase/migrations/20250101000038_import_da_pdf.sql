-- Import da PDF: i due valori di enum che servono, e nient'altro.
--
-- Stanno da soli in un file loro perché `alter type ... add value` non può
-- essere usato nella stessa transazione che lo aggiunge: è la stessa ragione
-- per cui la 30 esiste separata dalla 31.
--
-- `pdf_future` c'era dal primo giorno, come segnaposto in `batch_source_type`.
-- Non lo togliamo — cancellare un valore da un enum in PostgreSQL non si può
-- fare senza ricostruire il tipo, e non ne vale la pena — ma non lo usiamo:
-- una sorgente vera si chiama con il nome delle altre, `pdf_upload`.

alter type batch_source_type add value if not exists 'pdf_upload';

-- Il legame fra il prodotto e il documento da cui è nato. Gli altri due valori
-- raccontano un'altra storia: `sku_exact` vuol dire «questo file è stato
-- associato al prodotto perché lo SKU coincide», `manual` vuol dire «l'ha
-- deciso una persona». Qui non è vero né l'uno né l'altro: il prodotto esiste
-- PERCHÉ esiste quel PDF.
alter type product_link_type add value if not exists 'pdf_source';
