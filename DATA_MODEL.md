# Modelo de dados para produção

A implementação atual guarda o catálogo em `dist/catalog.json`, as leituras reais em `data/prices.jsonl` no servidor local e a build/lista seguida no navegador. O esquema SQL abaixo é uma proposta para sincronização multi-dispositivo e maior escala; **não é a base de dados usada pelo código atual**. A unidade central futura é uma listagem por SKU/EAN + loja, com observações imutáveis.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE retailers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  integration_kind TEXT NOT NULL CHECK (integration_kind IN ('official_api','partner_feed','manual','approved_fetch')),
  terms_url TEXT,
  robots_url TEXT,
  min_refresh_minutes INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT
);

CREATE TABLE component_models (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('CPU','motherboard','RAM','GPU','storage','PSU','case','cooling','fan','monitor')),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  ean TEXT UNIQUE,
  mpn TEXT,
  specifications_json TEXT NOT NULL DEFAULT '{}',
  -- Ex.: CPU {socket, tdp_w, ram_type}; GPU {length_mm, tdp_w, pcie_power_connectors}
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand, model, mpn)
);

CREATE TABLE product_listings (
  id TEXT PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailers(id),
  component_model_id TEXT NOT NULL REFERENCES component_models(id),
  retailer_sku TEXT,
  url TEXT NOT NULL,
  title_at_source TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  active INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  UNIQUE (retailer_id, retailer_sku),
  UNIQUE (retailer_id, url)
);

CREATE TABLE price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES product_listings(id),
  observed_at TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  delivery_cents INTEGER,
  availability TEXT NOT NULL CHECK (availability IN ('in_stock','limited','preorder','out_of_stock','unknown')),
  source_method TEXT NOT NULL CHECK (source_method IN ('api','feed','approved_fetch','manual')),
  raw_fingerprint TEXT,
  UNIQUE (listing_id, observed_at)
);
CREATE INDEX idx_prices_listing_time ON price_observations(listing_id, observed_at DESC);

CREATE TABLE performance_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_model_id TEXT NOT NULL REFERENCES component_models(id),
  benchmark_name TEXT NOT NULL,
  benchmark_version TEXT,
  score REAL NOT NULL CHECK (score > 0),
  higher_is_better INTEGER NOT NULL DEFAULT 1,
  source_url TEXT,
  licence_note TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (component_model_id, benchmark_name, benchmark_version)
);

CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_budget_cents INTEGER,
  intended_use TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE build_items (
  build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('CPU','motherboard','RAM','GPU','storage','PSU','case','cooling','fan','monitor')),
  component_model_id TEXT REFERENCES component_models(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes TEXT,
  PRIMARY KEY (build_id, slot)
);

CREATE TABLE price_alerts (
  id TEXT PRIMARY KEY,
  component_model_id TEXT NOT NULL REFERENCES component_models(id),
  target_price_cents INTEGER,
  trigger_on_historic_low INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_triggered_at TEXT
);

CREATE TABLE refresh_runs (
  id TEXT PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailers(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','rate_limited','skipped_cache')),
  listings_checked INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);
CREATE INDEX idx_refresh_retailer_time ON refresh_runs(retailer_id, started_at DESC);
```

## Regras de domínio essenciais

- Guardar preços em cêntimos, nunca `float`.
- Identificar produtos pelo EAN; só usar MPN+marca como alternativa e marcar a correspondência como `needs_review` fora do schema mínimo.
- O preço histórico vem de `price_observations`; nunca sobrescrever a leitura anterior. O preço atual é a última observação válida por listagem.
- Para a relação preço/desempenho, usar o preço mais baixo em stock por modelo e um score da mesma família e versão de benchmark. Não misturar scores de fontes/versionamentos diferentes.
- `specifications_json` deve ser validado no backend por schema de categoria. A validação de compatibilidade usa estes campos estruturados, não texto livre nem IA.
- A chamada de IA recebe uma cópia mínima da build, avisos determinísticos e objetivo/orçamento. A chave da API fica apenas no servidor.
