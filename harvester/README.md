# Exam Harvester

A local pipeline that builds a question bank. It crawls exam websites, parses dual-column
Hindi/English exam PDFs (with OCR fallback), turns them into bilingual MCQs with Gemini
structured output, removes duplicates in SQLite, and exports SQL ready for **Cloudflare D1**
or **PostgreSQL + pgvector**.

```
download ──► data/raw/pdfs ──► parse-pdf ──► raw_chunks ──► normalize (Gemini) ──► questions
                                   │                                                  │
                         data/processed/*.pages.json          answer-key ──► OFFICIAL_KEY answers
                                                                                      │
                                                         export ──► data/exports/*.sql + questions_master.json
```

## 1. Setup (Windows)

```powershell
cd harvester
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env        # then put your GEMINI_API_KEY in .env
.venv\Scripts\python -m src.cli init-db
# only needed for --render-js on JavaScript-heavy sites:
.venv\Scripts\playwright install chromium
```

### Tesseract (OCR fallback)

```powershell
winget install --id UB-Mannheim.TesseractOCR -e
```

The binary is found automatically at `C:\Program Files\Tesseract-OCR\tesseract.exe`. You can
override the path with `TESSERACT_CMD`. Hindi needs `hin.traineddata`. If the installer didn't
add it, put `hin.traineddata` and `eng.traineddata` (from
[tessdata_best](https://github.com/tesseract-ocr/tessdata_best)) in `harvester/tessdata/`.
The engine uses that folder automatically when it finds `hin.traineddata` there.

## 2. Commands

All commands run from `harvester/` with `.venv\Scripts\python -m src.cli <command>`.

| Command | What it does |
|---|---|
| `download --url URL [--exam UPPCS] [--year 2025] [--stage PRELIMS] [--limit N] [--dry-run] [--render-js]` | Crawls the UPPSC listing (replays ASP.NET postbacks for year tabs), any HTML page with PDF links, or a direct PDF. Streams each file to disk, skips files already downloaded (by URL or SHA256), and registers it in `exam_papers`. |
| `parse-pdf --file F [--exam-id ID] [--exam-name ..] [--paper-name ..] [--year Y] [--ocr auto\|always\|never] [--pages 2-5]` | Splits pages into columns, re-OCRs columns with poor text quality using `hin+eng`, removes headers and footers, writes `data/processed/<id>.pages.json`, and stores LLM-sized `raw_chunks`. |
| `parse-html --file page.html --exam-id ID` | Stages question cards from a saved HTML question bank. |
| `normalize [--limit 50] [--paper-id ID] [--concurrency 2] [--retry-failed] [--model ..]` | Sends pending chunks to Gemini (`response_schema`), validates each MCQ separately, removes duplicates, and inserts the rest. |
| `answer-key --file key.pdf --paper-id ID [--series A] [--no-llm]` | Loads an official answer key and replaces answers with `answer_source=OFFICIAL_KEY`. |
| `export --format d1\|postgres\|json [--out F] [--status VERIFIED]` | Writes `batch_insert.sql` (D1) or `postgres_import.sql`, and always writes `questions_master.json`. By default it exports `PENDING,VERIFIED` questions. |
| `stats` | Shows counts by subject, language, verification status, answer source and chunk status. |
| `set-status ID... --status VERIFIED\|REJECTED` | Records the result of manual review. |
| `embeddings enqueue\|status\|run` | Embedding job queue (see §5). |

### Typical run

```powershell
python -m src.cli download --url "https://uppsc.up.nic.in/OuterPages/PreQuesPapers.aspx?ID=PrevQues" --exam UPPCS --year 2025 --stage PRELIMS
python -m src.cli parse-pdf --file "data\raw\pdfs\<file>.pdf" --exam-id <paper_id printed by download>
python -m src.cli normalize --limit 10
python -m src.cli stats
python -m src.cli export --format d1 --out data\exports\d1_import.sql
npx wrangler d1 execute <DB_NAME> --remote --file=data\exports\d1_import.sql
```

## 3. Design notes

- **Column detection** groups PyMuPDF *words* into a left and a right column. It doesn't rely
  on the PDF's text blocks because scanned booklets are slightly skewed, and the scanner's own
  OCR layer (for example OmniPage) often merges lines across both columns. Reading order is
  left column top to bottom, then right column.
- **When to OCR:** a column is OCR'd at 300 DPI with Tesseract in these cases:
  - **Scanned pages** (one image covers ≥70 % of the page) are always OCR'd. Their vendor OCR
    layer can't be trusted: in the 2025 UPPCS GS-I paper it dropped whole option rows
    (`(a)`, `(b)`, `(d)`) and turned Devanagari into Latin garbage (`3TEI 37 1A fii`).
  - **Born-digital pages** are OCR'd only when the text layer looks bad. Each column gets a
    quality score (share of plausible words plus density of common English words), and OCR
    runs when any of these hold:
    - the score is below 0.6;
    - it contains Unicode replacement glyphs;
    - the page has fewer than 100 characters;
    - the other column is clean English while this one has no Devanagari.
  - Columns that already read as clean English are OCR'd with `eng`; the rest use `hin+eng`.
- **Chunks** follow page boundaries, so an English column and its Hindi twin always reach
  Gemini together. Each chunk ends with a short *lookahead* from the next page, so a question
  cut off at a page break can still be completed. The prompt tells Gemini never to output a
  question that starts inside the lookahead. Instruction pages (no `(a)`/`(b)` option markers)
  are skipped to save API calls.
- **Deduplication hash** = SHA256 of the normalized question stem plus the *sorted* normalized
  option texts. Hashing the stem alone would merge different questions that share generic
  stems such as "Which of the following statements is/are correct?". Sorting the options
  makes Series A/B/C/D copies (shuffled options) hash the same. Duplicates are stored in
  `question_variants` (paper and question number), not dropped silently.
- **`answer_source`**:
  - `OFFICIAL_KEY` — from `answer-key`.
  - `SOURCE_PRINTED` — the answer was printed in the source.
  - `LLM_INFERRED` — Gemini's best guess; check these before marking `VERIFIED`.
  - `correct_option='X'` — the question was deleted or cancelled in the official key.
- **Rate limits**: an async requests-per-minute limiter (`GEMINI_RPM`) plus exponential
  backoff that respects the server's `retryDelay` on 429/5xx. One bad MCQ never discards a
  whole chunk. Failed chunks are marked `FAILED` and can be re-run with `--retry-failed`.
- **Politeness**: 1.5–3 s random delay per host, user-agent rotation, retries with backoff and
  `Retry-After`, and at most 2 concurrent downloads. UPPSC `Open_PDF.aspx` links are fetched
  with the listing page as `Referer`, the same as clicking the link in a browser.

## 4. Schema

`exam_papers` and `questions` follow the live exam-engine schema, with these added columns:
`question_number`, `answer_source`, `series`, `document_type`, `file_sha256`, `page_count`,
`created_at`, `updated_at`. Tables used only by the pipeline: `raw_chunks`, `answer_keys`,
`question_variants`, `question_embeddings`. The export DDL is generated from the SQLAlchemy
models, so it can't drift from the local schema. Internal columns (`chunk_id`) are left out of
exports.

## 5. Embeddings (prepared, not generated)

- `question_embeddings` stores **one row per (question, provider, model)**. Columns: `provider`,
  `model`, `model_version`, `task_type`, `dimensions`, `embedding`, `source_content_hash`,
  `status` (PENDING/PROCESSING/DONE/FAILED/STALE), `attempts`, `error`, `claimed_at`,
  `generated_at`.
- The vector has **no fixed size**. SQLite stores it as a packed float32 BLOB. PostgreSQL
  exports it as an untyped pgvector `vector`, and `CREATE EXTENSION vector` is emitted.
- Once you pick a model, fix the size and add an index with a migration:
  ```sql
  ALTER TABLE question_embeddings ALTER COLUMN embedding TYPE vector(768);
  CREATE INDEX ON question_embeddings USING hnsw (embedding vector_cosine_ops);
  ```
- The table also acts as the **job queue**:
  - `embeddings enqueue` only writes to the database. It makes no API calls and costs nothing.
  - Workers lease rows (`claimed_at`; `FOR UPDATE SKIP LOCKED` on Postgres).
  - When a question's text changes, its embedding row becomes STALE.
- **Providers** plug into `src/embeddings/base.py`. Only the offline `fake` provider ships.
  To add Gemini later, subclass `EmbeddingProvider` (`name="gemini"`, `model=...`,
  `async embed()`), call `register_provider("gemini", GeminiEmbeddingProvider)`, then run
  `embeddings run --provider gemini --allow-cost` from any background runner (cron, Render
  job, Cloud Run job). The ingestion pipeline doesn't need to change.

## 6. Tests

```powershell
.venv\Scripts\python -m pytest -q
```

## Layout

```
config.py                 paths, env settings, logging
src/cli.py                Typer CLI
src/pipeline.py           orchestration used by the CLI
src/crawler/              base_crawler (httpx + Playwright), pdf_downloader, site_scrapers/uppsc.py
src/parsers/              pdf_column_parser, ocr_engine, html_parser
src/normalizer/           schema (Pydantic), gemini_cleaner
src/storage/              database, models, deduplicator, exporter
src/embeddings/           provider interface + job queue service
data/{raw,processed,exports,logs}
```
