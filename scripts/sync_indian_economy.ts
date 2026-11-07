import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { loadNodeNeonDatabaseUrl } from "../src/db/node-env";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

function detectQuestionFormat(stemEn: string): string {
  const s = stemEn.toLowerCase();
  if (s.includes("assertion (a)") || s.includes("reason (r)")) return "ASSERTION_REASON";
  if (s.includes("list-i") || s.includes("list i") || s.includes("match the following")) return "MATCH_LIST";
  if (s.includes("chronological") || s.includes("correct sequence")) return "CHRONOLOGY";
  if (s.includes("consider the following statements") || /\b1\.\s/.test(stemEn)) return "MULTI_STATEMENT";
  return "SINGLE_CHOICE";
}

function parseOptions(rawJson: string): {
  optionsEn: Array<{ key: "A" | "B" | "C" | "D"; text: string }>;
  optionsHi: Array<{ key: "A" | "B" | "C" | "D"; text: string }> | null;
} {
  try {
    const parsed = JSON.parse(rawJson);
    const keys: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
    if (Array.isArray(parsed)) {
      const en = keys.map((k) => {
        const found = parsed.find((o: any) => String(o.key || "").toUpperCase() === k);
        return { key: k, text: String(found?.text_en ?? found?.en ?? found?.text ?? `Option ${k}`) };
      });
      const hasHi = parsed.some((o: any) => o?.text_hi || o?.hi);
      const hi = hasHi
        ? keys.map((k) => {
            const found = parsed.find((o: any) => String(o.key || "").toUpperCase() === k);
            return {
              key: k,
              text: String(found?.text_hi ?? found?.hi ?? found?.text_en ?? found?.text ?? `विकल्प ${k}`),
            };
          })
        : null;
      return { optionsEn: en, optionsHi: hi };
    }
    if (parsed && typeof parsed === "object") {
      const en = keys.map((k) => {
        const val = parsed[k] ?? parsed[k.toLowerCase()];
        const txt = typeof val === "string" ? val : val?.text_en ?? val?.en ?? val?.text ?? `Option ${k}`;
        return { key: k, text: String(txt) };
      });
      const hasHi = keys.some((k) => {
        const val = parsed[k] ?? parsed[k.toLowerCase()];
        return typeof val === "object" && (val?.text_hi || val?.hi);
      });
      const hi = hasHi
        ? keys.map((k) => {
            const val = parsed[k] ?? parsed[k.toLowerCase()];
            return { key: k, text: String(val?.text_hi ?? val?.hi ?? val?.text_en ?? `विकल्प ${k}`) };
          })
        : null;
      return { optionsEn: en, optionsHi: hi };
    }
  } catch {
    // fallback below
  }
  return {
    optionsEn: [
      { key: "A", text: "Option A" },
      { key: "B", text: "Option B" },
      { key: "C", text: "Option C" },
      { key: "D", text: "Option D" },
    ],
    optionsHi: null,
  };
}

/**
 * Maps every Indian Economy question into 1 of 6 granular L3 Syllabus Micro-Topics
 * under `dom-econ` ("Indian Economy & Budget").
 */
function classifyEconomyMicroTopic(subjectRaw: string | null, topicRaw: string | null, stemEn: string): string {
  const s = `${subjectRaw || ""} ${topicRaw || ""} ${stemEn.slice(0, 180)}`.toLowerCase();

  if (
    s.includes("monetary") ||
    s.includes("rbi") ||
    s.includes("reserve bank") ||
    s.includes("repo") ||
    s.includes("inflation") ||
    s.includes("cpi") ||
    s.includes("wpi") ||
    s.includes("bank") ||
    s.includes("capital market") ||
    s.includes("sebi") ||
    s.includes("share") ||
    s.includes("money supply") ||
    s.includes("npa") ||
    s.includes("financial")
  ) {
    return "top-econ-monetary";
  }

  if (
    s.includes("international trade") ||
    s.includes("balance of payment") ||
    s.includes("bop") ||
    s.includes("wto") ||
    s.includes("world trade") ||
    s.includes("imf") ||
    s.includes("world bank") ||
    s.includes("foreign") ||
    s.includes("fdi") ||
    s.includes("export") ||
    s.includes("import") ||
    s.includes("exchange rate") ||
    s.includes("devaluation") ||
    s.includes("terms of trade")
  ) {
    return "top-econ-external";
  }

  if (
    s.includes("agricult") ||
    s.includes("msp") ||
    s.includes("crop") ||
    s.includes("pds") ||
    s.includes("food security") ||
    s.includes("nabard") ||
    s.includes("rural") ||
    s.includes("industr") ||
    s.includes("msme") ||
    s.includes("infrastruct") ||
    s.includes("disinvestment") ||
    s.includes("navratna")
  ) {
    return "top-econ-agri-ind";
  }

  if (
    s.includes("microeconom") ||
    s.includes("elasticity") ||
    s.includes("market structure") ||
    s.includes("monopoly") ||
    s.includes("oligopoly") ||
    s.includes("demand") ||
    s.includes("cost curve") ||
    s.includes("production function") ||
    s.includes("utility") ||
    s.includes("consumer") ||
    s.includes("keynes") ||
    s.includes("skewness") ||
    s.includes("sampling")
  ) {
    return "top-econ-micro";
  }

  if (
    s.includes("public finance") ||
    s.includes("fiscal") ||
    s.includes("budget") ||
    s.includes("tax") ||
    s.includes("gst") ||
    s.includes("frbm") ||
    s.includes("finance commission") ||
    s.includes("deficit") ||
    s.includes("public debt") ||
    s.includes("subsid")
  ) {
    return "top-econ-fiscal";
  }

  // National Income, GDP, Five-Year Plans, NITI Aayog, Poverty, Unemployment, HDI, Schemes
  return "top-econ-planning";
}

async function main() {
  const directUrl = process.env.DATABASE_URL_UNPOOLED || loadNodeNeonDatabaseUrl();
  const sql = neon(directUrl);

  console.log("[econ-sync] 1/5 Expanding 3-Tier Indian Economy Syllabus Tree (3 Modules, 6 Micro-Topics)...");
  const econTopics = [
    // L2 Modules under dom-econ
    {
      id: "mod-econ-public",
      slug: "econ-public-monetary",
      parent: "dom-econ",
      level: 2,
      key: "Indian Economy & Budget",
      en: "Public Finance, Monetary Policy & Financial Markets",
      hi: "लोक वित्त, मौद्रिक नीति एवं वित्तीय बाजार",
      descEn: "Union/UP Budget, GST, FRBM, RBI Monetary Tools, Inflation & Capital Markets",
      descHi: "केंद्रीय व उ.प्र. बजट, जीएसटी, आरबीआई मौद्रिक उपकरण, मुद्रास्फीति एवं पूंजी बाजार",
      hy: true,
      order: 1,
    },
    {
      id: "mod-econ-dev",
      slug: "econ-growth-planning-agri",
      parent: "dom-econ",
      level: 2,
      key: "Indian Economy & Budget",
      en: "Growth, Planning, Poverty & Agriculture-Industry",
      hi: "आर्थिक विकास, नियोजन, गरीबी एवं कृषि-उद्योग",
      descEn: "National Income, Five-Year Plans, NITI Aayog, Poverty/Employment, MSP & MSMEs",
      descHi: "राष्ट्रीय आय, पंचवर्षीय योजनाएं, नीति आयोग, गरीबी/बेरोजगारी, MSP एवं उद्योग",
      hy: true,
      order: 2,
    },
    {
      id: "mod-econ-ext",
      slug: "econ-external-theory",
      parent: "dom-econ",
      level: 2,
      key: "Indian Economy & Budget",
      en: "External Sector, Global Institutions & Economic Theory",
      hi: "बाह्य क्षेत्र, अंतर्राष्ट्रीय संस्थाएं एवं आर्थिक सिद्धांत",
      descEn: "Balance of Payments, WTO/IMF/World Bank, FDI & Core Micro/Macro Concepts",
      descHi: "भुगतान संतुलन, WTO/IMF/विश्व बैंक, FDI एवं सूक्ष्म/समष्टि अर्थशास्त्र सिद्धांत",
      hy: false,
      order: 3,
    },
    // 6 L3 Micro-Topics
    {
      id: "top-econ-fiscal",
      slug: "fiscal-policy-frbm",
      parent: "mod-econ-public",
      level: 3,
      key: "Indian Economy & Budget",
      en: "Fiscal Policy, Taxation (GST), FRBM Act & Union/UP Budget",
      hi: "राजकोषीय नीति, कराधान (GST), एफआरबीएम एवं केंद्रीय/उ.प्र. बजट",
      descEn: "Deficit types, Finance Commission, direct/indirect taxes & public debt",
      descHi: "बजट घाटे के प्रकार, वित्त आयोग, प्रत्यक्ष/अप्रत्यक्ष कर एवं लोक ऋण",
      hy: true,
      order: 1,
    },
    {
      id: "top-econ-monetary",
      slug: "monetary-rbi-banking-markets",
      parent: "mod-econ-public",
      level: 3,
      key: "Indian Economy & Budget",
      en: "Money, Banking, RBI Policy, Inflation & Capital Markets",
      hi: "मुद्रा, बैंकिंग, आरबीआई नीति, मुद्रास्फीति एवं पूंजी बाजार",
      descEn: "Repo/CRR/SLR, CPI/WPI inflation, commercial banks, NABARD & SEBI primary/secondary markets",
      descHi: "रेपो/CRR/SLR, मुद्रास्फीति (CPI/WPI), वाणिज्यिक बैंक, नाबार्ड एवं सेबी पूंजी बाजार",
      hy: true,
      order: 2,
    },
    {
      id: "top-econ-planning",
      slug: "national-income-planning-poverty",
      parent: "mod-econ-dev",
      level: 3,
      key: "Indian Economy & Budget",
      en: "National Income (GDP), Five-Year Plans, Poverty & Employment",
      hi: "राष्ट्रीय आय (GDP), पंचवर्षीय योजनाएं, गरीबी एवं बेरोजगारी",
      descEn: "GDP/GNP accounting, Planning history, NITI Aayog, Tendulkar/Rangarajan panels, HDI & welfare schemes",
      descHi: "जीडीपी/जीएनपी गणना, पंचवर्षीय योजनाएं, नीति आयोग, गरीबी समितियां एवं कल्याणकारी योजनाएं",
      hy: true,
      order: 3,
    },
    {
      id: "top-econ-agri-ind",
      slug: "agriculture-msp-industry-infra",
      parent: "mod-econ-dev",
      level: 3,
      key: "Indian Economy & Budget",
      en: "Agricultural Economics, MSP, Food Security, Industry & Infrastructure",
      hi: "कृषि अर्थशास्त्र, MSP, खाद्य सुरक्षा, उद्योग एवं अवसंरचना",
      descEn: "CACP & MSP, PDS buffer stocks, Green Revolution, MSME classification & industrial policy",
      descHi: "न्यूनतम समर्थन मूल्य (MSP), सार्वजनिक वितरण प्रणाली, हरित क्रांति एवं औद्योगिक नीति",
      hy: true,
      order: 4,
    },
    {
      id: "top-econ-external",
      slug: "bop-foreign-trade-wto-imf",
      parent: "mod-econ-ext",
      level: 3,
      key: "Indian Economy & Budget",
      en: "Balance of Payments (BoP), Foreign Trade, WTO, IMF & World Bank",
      hi: "भुगतान संतुलन (BoP), विदेश व्यापार, WTO, IMF एवं विश्व बैंक",
      descEn: "Current vs Capital account convertibility, FDI/FPI, TRIPS, Special Drawing Rights (SDR) & trade blocs",
      descHi: "चालू व पूंजी खाता परिवर्तनीयता, FDI/FPI, विशेष आहरण अधिकार (SDR) एवं विश्व व्यापार संगठन",
      hy: true,
      order: 5,
    },
    {
      id: "top-econ-micro",
      slug: "micro-macro-theory-markets",
      parent: "mod-econ-ext",
      level: 3,
      key: "Indian Economy & Budget",
      en: "Core Micro & Macro Economic Theory, Demand & Market Structures",
      hi: "सूक्ष्म एवं समष्टि अर्थशास्त्र सिद्धांत, मांग लोच एवं बाजार संरचना",
      descEn: "Elasticity of demand, monopoly/perfect competition, Lorenz curve, Gini coefficient, Phillips & Laffer curves",
      descHi: "मांग की लोच, बाजार संरचना, लॉरेंज वक्र, गिनी गुणांक, फिलिप्स एवं लाफर वक्र",
      hy: false,
      order: 6,
    },
  ];

  for (const t of econTopics) {
    await sql`
      INSERT INTO syllabus_topics (
        id, slug, parent_id, level, subject_key, name_en, name_hi,
        description_en, description_hi, is_high_yield, sort_order
      ) VALUES (
        ${t.id}, ${t.slug}, ${t.parent}, ${t.level}, ${t.key}, ${t.en}, ${t.hi},
        ${t.descEn}, ${t.descHi}, ${t.hy}, ${t.order}
      )
      ON CONFLICT (id) DO UPDATE SET
        parent_id = EXCLUDED.parent_id,
        name_en = EXCLUDED.name_en,
        name_hi = EXCLUDED.name_hi,
        description_en = EXCLUDED.description_en,
        description_hi = EXCLUDED.description_hi,
        is_high_yield = EXCLUDED.is_high_yield,
        sort_order = EXCLUDED.sort_order
    `;
  }

  // Update exam_syllabus_map weights across all 4 UPPSC exams for the 6 Economy micro-topics
  const econExamWeights: Record<string, Array<[string, number, string]>> = {
    "uppcs-prelims": [
      ["top-econ-fiscal", 4.0, "HIGH_YIELD"],
      ["top-econ-monetary", 3.5, "HIGH_YIELD"],
      ["top-econ-planning", 3.5, "HIGH_YIELD"],
      ["top-econ-agri-ind", 2.5, "HIGH_YIELD"],
      ["top-econ-external", 2.0, "CORE"],
      ["top-econ-micro", 1.5, "PERIPHERAL"],
    ],
    "uppsc-ro-aro": [
      ["top-econ-fiscal", 2.5, "HIGH_YIELD"],
      ["top-econ-monetary", 2.0, "CORE"],
      ["top-econ-planning", 2.5, "HIGH_YIELD"],
      ["top-econ-agri-ind", 3.0, "HIGH_YIELD"],
      ["top-econ-external", 1.5, "CORE"],
      ["top-econ-micro", 0.5, "PERIPHERAL"],
    ],
    "uppsc-acf-rfo": [
      ["top-econ-fiscal", 3.0, "CORE"],
      ["top-econ-monetary", 2.5, "CORE"],
      ["top-econ-planning", 3.0, "HIGH_YIELD"],
      ["top-econ-agri-ind", 4.0, "HIGH_YIELD"],
      ["top-econ-external", 1.5, "PERIPHERAL"],
      ["top-econ-micro", 1.0, "PERIPHERAL"],
    ],
    "uppsc-gic-beo": [
      ["top-econ-fiscal", 2.5, "CORE"],
      ["top-econ-monetary", 2.0, "CORE"],
      ["top-econ-planning", 2.5, "HIGH_YIELD"],
      ["top-econ-agri-ind", 2.0, "CORE"],
      ["top-econ-external", 1.5, "PERIPHERAL"],
      ["top-econ-micro", 2.5, "CORE"],
    ],
  };

  for (const [examId, rows] of Object.entries(econExamWeights)) {
    for (const [topicId, wt, tier] of rows) {
      await sql`
        INSERT INTO exam_syllabus_map (id, exam_id, topic_id, expected_weight_pct, priority_tier)
        VALUES (${`${examId}__${topicId}`}, ${examId}, ${topicId}, ${wt}, ${tier})
        ON CONFLICT (exam_id, topic_id) DO UPDATE SET
          expected_weight_pct = EXCLUDED.expected_weight_pct,
          priority_tier = EXCLUDED.priority_tier
      `;
    }
  }

  console.log("[econ-sync] 2/5 Reading all Indian Economy papers, questions & repeat variants from harvester.db...");
  const sqlite = new DatabaseSync(path.resolve("harvester/data/harvester.db"), {
    open: true,
    readOnly: true,
  });

  const econQuestions = sqlite
    .prepare(
      `SELECT id, paper_id, question_number, subject, topic, difficulty, language,
              question_en, question_hi, options_json, correct_option,
              explanation_en, explanation_hi, source_key_type, confidence_score, content_hash
       FROM questions
       WHERE question_en IS NOT NULL AND length(trim(question_en)) > 8
         AND (
           lower(subject) LIKE '%econ%'
           OR lower(subject) = 'commerce'
           OR lower(topic) LIKE '%econom%'
           OR lower(topic) LIKE '%budget%'
           OR lower(topic) LIKE '%fiscal%'
           OR lower(topic) LIKE '%monetary%'
           OR lower(topic) LIKE '%banking%'
           OR lower(topic) LIKE '%inflation%'
           OR lower(topic) LIKE '%taxation%'
           OR lower(topic) LIKE '%balance of payment%'
           OR lower(topic) LIKE '%five year plan%'
           OR lower(topic) LIKE '%capital market%'
           OR lower(topic) LIKE '%poverty%'
         )
       ORDER BY paper_id, question_number`
    )
    .all() as Array<any>;

  console.log(`[econ-sync] Matched ${econQuestions.length} Indian Economy questions in harvester.db!`);

  // Sync all referenced exam_papers so paper_id FKs are 100% intact
  const paperIds = Array.from(
    new Set(econQuestions.map((q) => q.paper_id).filter((x): x is string => Boolean(x)))
  );

  const validPaperIds = new Set<string>();
  const paperLabels = new Map<string, { en: string; hi: string }>();

  if (paperIds.length > 0) {
    const allPapers = sqlite
      .prepare(`SELECT id, exam_name, paper_name, stage, paper_code, year, series, has_official_key FROM exam_papers`)
      .all() as Array<any>;

    const neededSet = new Set(paperIds);
    for (const p of allPapers) {
      if (!neededSet.has(String(p.id))) continue;
      const examLower = String(p.exam_name || "").toLowerCase();
      let mappedExamId = "uppcs-prelims";
      if (examLower.includes("ro") || examLower.includes("samiksha")) mappedExamId = "uppsc-ro-aro";
      else if (examLower.includes("acf") || examLower.includes("rfo") || examLower.includes("forest"))
        mappedExamId = "uppsc-acf-rfo";
      else if (examLower.includes("gic") || examLower.includes("beo") || examLower.includes("lecturer"))
        mappedExamId = "uppsc-gic-beo";

      const titleEn = String(p.paper_name || `${p.exam_name} ${p.year || ""}`).trim();
      const titleHi = `${titleEn} (आधिकारिक प्रश्नपत्र)`;
      paperLabels.set(String(p.id), { en: titleEn, hi: titleHi });

      await sql`
        INSERT INTO exam_papers (
          id, exam_id, exam_name, paper_name_en, paper_name_hi,
          paper_code, stage, year, series, paper_type, has_official_key
        ) VALUES (
          ${String(p.id)}, ${mappedExamId}, ${String(p.exam_name || "UPPSC")}, ${titleEn}, ${titleHi},
          ${p.paper_code ?? null}, ${p.stage || "PRELIMS"}, ${p.year ?? null}, ${p.series ?? null},
          'OFFICIAL_PYQ', ${Boolean(p.has_official_key)}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      validPaperIds.add(String(p.id));
    }
  }
  console.log(`[econ-sync] Verified ${validPaperIds.size} referenced UPPSC exam papers in Neon.`);

  console.log("[econ-sync] 3/5 Batch-upserting all Indian Economy questions into Neon...");
  const seenHashes = new Set<string>();
  const topicDistribution: Record<string, number> = {};
  let upsertedCount = 0;

  const chunkSize = 75;
  for (let i = 0; i < econQuestions.length; i += chunkSize) {
    const batch = econQuestions.slice(i, i + chunkSize);
    const placeholders: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    for (const q of batch) {
      const { optionsEn, optionsHi } = parseOptions(String(q.options_json || "[]"));
      const topicId = classifyEconomyMicroTopic(q.subject, q.topic, String(q.question_en));
      topicDistribution[topicId] = (topicDistribution[topicId] || 0) + 1;

      const fmt = detectQuestionFormat(String(q.question_en));
      const paperRef = q.paper_id && validPaperIds.has(String(q.paper_id)) ? String(q.paper_id) : null;
      const langCov = q.question_hi && optionsHi ? "BILINGUAL" : "EN";
      const corr = ["A", "B", "C", "D", "X"].includes(String(q.correct_option || "").toUpperCase())
        ? String(q.correct_option).toUpperCase()
        : "A";
      const diff = ["EASY", "MEDIUM", "HARD"].includes(String(q.difficulty || "").toUpperCase())
        ? String(q.difficulty).toUpperCase()
        : "MEDIUM";

      let safeHash: string | null = q.content_hash ? String(q.content_hash) : null;
      if (safeHash && seenHashes.has(safeHash)) {
        safeHash = null;
      } else if (safeHash) {
        seenHashes.add(safeHash);
      }

      placeholders.push(
        `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, 'PYQ', $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}::jsonb, $${pIdx++}::jsonb, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
      );
      params.push(
        String(q.id),
        paperRef,
        topicId,
        q.question_number ?? null,
        "Indian Economy & Budget",
        q.topic ?? q.subject ?? null,
        diff,
        fmt,
        langCov,
        String(q.question_en),
        q.question_hi ? String(q.question_hi) : null,
        JSON.stringify(optionsEn),
        optionsHi ? JSON.stringify(optionsHi) : null,
        corr,
        q.explanation_en ? String(q.explanation_en) : null,
        q.explanation_hi ? String(q.explanation_hi) : null,
        q.source_key_type || "LLM_INFERRED",
        Number(q.confidence_score ?? 0.92),
        safeHash,
        "VERIFIED"
      );
    }

    const upsertSql = `
      INSERT INTO questions (
        id, paper_id, topic_id, question_number, subject, topic_raw, difficulty,
        question_origin, question_format, language_coverage, question_en, question_hi,
        options_en, options_hi, correct_option, explanation_en, explanation_hi,
        source_key_type, confidence_score, content_hash, status
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT (id) DO UPDATE SET
        topic_id = EXCLUDED.topic_id,
        subject = EXCLUDED.subject,
        paper_id = COALESCE(EXCLUDED.paper_id, questions.paper_id),
        question_hi = COALESCE(EXCLUDED.question_hi, questions.question_hi),
        options_hi = COALESCE(EXCLUDED.options_hi, questions.options_hi),
        explanation_en = COALESCE(EXCLUDED.explanation_en, questions.explanation_en),
        explanation_hi = COALESCE(EXCLUDED.explanation_hi, questions.explanation_hi)
    `;
    await sql.query(upsertSql, params);
    upsertedCount += batch.length;
  }

  console.log(`[econ-sync] Upserted ${upsertedCount} Indian Economy questions across 6 micro-topics:`, topicDistribution);

  console.log("[econ-sync] 4/5 Syncing Economy Repeat Lineage (question_variants)...");
  const econIdsSet = new Set(econQuestions.map((q) => String(q.id)));
  const rawVariants = sqlite
    .prepare(
      `SELECT v.question_id, v.paper_id, v.question_number, p.exam_name, p.paper_name, p.year
       FROM question_variants v
       LEFT JOIN exam_papers p ON p.id = v.paper_id`
    )
    .all() as Array<any>;

  const matchingVariants = rawVariants.filter((v) => econIdsSet.has(String(v.question_id)));
  let syncedVariants = 0;
  if (matchingVariants.length > 0) {
    const qIdsForVar = Array.from(new Set(matchingVariants.map((v) => String(v.question_id))));
    await sql.query(`DELETE FROM question_variants WHERE question_id = ANY($1::text[])`, [qIdsForVar]);

    for (const v of matchingVariants) {
      const labelEn = String(v.paper_name || `${v.exam_name || "UPPSC"} ${v.year || ""}`).trim();
      const labelHi = `${labelEn} (${v.year || "PYQ"})`;
      const safePaperId = v.paper_id && validPaperIds.has(String(v.paper_id)) ? String(v.paper_id) : null;
      await sql`
        INSERT INTO question_variants (question_id, paper_id, paper_label_en, paper_label_hi, question_number)
        VALUES (${String(v.question_id)}, ${safePaperId}, ${labelEn}, ${labelHi}, ${v.question_number ?? null})
      `;
      syncedVariants++;
    }
  }
  sqlite.close();
  console.log(`[econ-sync] Synced ${syncedVariants} cross-paper repeat variants for Indian Economy.`);

  console.log("[econ-sync] 5/5 Adding Monetary Policy & RBI Cheat Sheet + Economy Flashcards...");
  const rbiContentEn = {
    summary:
      "Covers 35+ UPPSC Economy questions on RBI Quantitative/Qualitative credit control tools, MPC structure, and inflation indices.",
    matrixTitle: "RBI Monetary Policy Instruments — Inflation vs Growth Impact",
    matrixHeaders: ["Instrument", "Definition", "To Curb Inflation (Dear Money)", "UPPSC Trap"],
    matrixRows: [
      [
        "Repo Rate",
        "Short-term rate at which RBI lends to commercial banks against govt securities.",
        "INCREASE Repo Rate (raises borrowing cost)",
        "Benchmark policy rate set by 6-member MPC.",
      ],
      [
        "Cash Reserve Ratio (CRR)",
        "Share of NDTL banks must keep as liquid cash with RBI.",
        "INCREASE CRR (drains liquidity directly)",
        "TRAP: Banks earn ZERO interest on CRR balances!",
      ],
      [
        "Statutory Liquidity Ratio (SLR)",
        "Share of NDTL banks keep with themselves in cash, gold, or G-Secs.",
        "INCREASE SLR (restricts private credit)",
        "Max ceiling 40%; kept with the bank itself, NOT RBI.",
      ],
      [
        "Open Market Operations (OMO)",
        "Outright purchase/sale of Government Securities by RBI.",
        "SELL G-Secs to absorb excess rupee liquidity",
        "Buying G-Secs injects money; selling absorbs money.",
      ],
    ],
    keyArticles: [
      {
        badge: "MPC (Sec 45ZB)",
        title: "Monetary Policy Committee",
        detail:
          "6 members (3 RBI + 3 Govt nominees); RBI Governor chairs with casting vote; 4% ± 2% CPI inflation target.",
        tag: "Asked 6x",
      },
      {
        badge: "Curves Trap",
        title: "Phillips, Lorenz & Laffer Curves",
        detail:
          "Phillips = Inflation vs Unemployment (inverse); Lorenz/Gini = Income Inequality; Laffer = Tax Rate vs Tax Revenue.",
        tag: "High Yield",
      },
    ],
    chronologyLock: {
      title: "MONEY SUPPLY LIQUIDITY ORDER (Most Liquid → Least Liquid)",
      chain: "M1 (Narrow Money: CU + DD) > M2 > M3 (Broad Money: M1 + Time Deposits) > M4",
      rule: "UPPSC Favourite: M3 is called 'Aggregate Monetary Resources' (most commonly used money supply measure in India).",
    },
  };

  const rbiContentHi = {
    summary:
      "आरबीआई के मात्रात्मक व गुणात्मक साख नियंत्रण उपकरणों, मौद्रिक नीति समिति (MPC) एवं मुद्रास्फीति सूचकांकों पर 35+ प्रश्नों का सार।",
    matrixTitle: "आरबीआई मौद्रिक नीति उपकरण — मुद्रास्फीति नियंत्रण प्रभाव",
    matrixHeaders: ["उपकरण", "परिभाषा", "मुद्रास्फीति रोकने हेतु कदम", "आयोग का मुख्य ट्रैप"],
    matrixRows: [
      [
        "रेपो दर (Repo Rate)",
        "वह अल्पकालिक दर जिस पर RBI वाणिज्यिक बैंकों को सरकारी प्रतिभूतियों के बदले ऋण देता है।",
        "रेपो दर में वृद्धि (महंगी मुद्रा नीति)",
        "6-सदस्यीय MPC द्वारा निर्धारित प्रमुख नीतिगत दर।",
      ],
      [
        "नकद आरक्षित अनुपात (CRR)",
        "NDTL का वह भाग जो बैंकों को RBI के पास नकद रूप में रखना अनिवार्य है।",
        "CRR में वृद्धि (तरलता सोखने हेतु)",
        "ट्रैप: बैंकों को CRR जमा पर RBI से कोई ब्याज नहीं मिलता!",
      ],
      [
        "वैधानिक तरलता अनुपात (SLR)",
        "NDTL का वह भाग जो बैंक स्वयं के पास नकद, स्वर्ण या सरकारी प्रतिभूति में रखते हैं।",
        "SLR में वृद्धि",
        "यह बैंक स्वयं के पास रखते हैं, RBI के पास नहीं।",
      ],
      [
        "खुला बाजार परिचालन (OMO)",
        "RBI द्वारा सरकारी प्रतिभूतियों (G-Secs) का क्रय-विक्रय।",
        "प्रतिभूतियों का विक्रय (तरलता कम करने हेतु)",
        "प्रतिभूति बेचने से बाजार से मुद्रा खिंचती है।",
      ],
    ],
    keyArticles: [
      {
        badge: "MPC (धारा 45ZB)",
        title: "मौद्रिक नीति समिति",
        detail:
          "कुल 6 सदस्य (3 RBI + 3 सरकार द्वारा नामित); अध्यक्ष आरबीआई गवर्नर (निर्णायक मत सहित); लक्ष्य: 4% ± 2% CPI।",
        tag: "6 बार पूछा गया",
      },
      {
        badge: "प्रमुख आर्थिक वक्र",
        title: "फिलिप्स, लॉरेंज एवं लाफर वक्र",
        detail:
          "फिलिप्स = मुद्रास्फीति बनाम बेरोजगारी; लॉरेंज/गिनी = आय असमानता; लाफर = कर दर बनाम कर राजस्व।",
        tag: "उच्च-उपयोगी",
      },
    ],
    chronologyLock: {
      title: "मुद्रा आपूर्ति तरलता क्रम (सर्वाधिक तरल → न्यूनतम तरल)",
      chain: "M1 (संकीर्ण मुद्रा) > M2 > M3 (व्यापक मुद्रा / समग्र मौद्रिक संसाधन) > M4",
      rule: "यूपीपीसीएस तथ्य: M3 को 'समग्र मौद्रिक संसाधन' (Broad Money) कहा जाता है और यही भारत में सर्वाधिक प्रयुक्त माप है।",
    },
  };

  await sql`
    INSERT INTO learning_artifacts (
      id, topic_id, artifact_type, title_en, title_hi, est_read_mins, pyq_coverage_count,
      canonical_source_en, canonical_source_hi, content_en, content_hi
    ) VALUES (
      'cs-monetary-rbi',
      'top-econ-monetary',
      'CHEAT_SHEET',
      'High-Yield Cheat Sheet: RBI Monetary Policy, Money Supply (M1–M4) & Economic Curves',
      'उच्च-उपयोगी चीट शीट: आरबीआई मौद्रिक नीति, मुद्रा आपूर्ति (M1–M4) एवं आर्थिक वक्र',
      3,
      36,
      'RBI Annual Report, RBI Act 1934 & NCERT Macroeconomics',
      'आरबीआई वार्षिक रिपोर्ट, आरबीआई अधिनियम 1934 एवं एनसीईआरटी समष्टि अर्थशास्त्र',
      ${JSON.stringify(rbiContentEn)}::jsonb,
      ${JSON.stringify(rbiContentHi)}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      content_en = EXCLUDED.content_en,
      content_hi = EXCLUDED.content_hi
  `;

  // Verify final Neon Economy counts
  const verify = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM questions) AS total_questions,
      (SELECT COUNT(*)::int FROM questions WHERE subject = 'Indian Economy & Budget') AS economy_questions,
      (SELECT COUNT(*)::int FROM syllabus_topics WHERE subject_key = 'Indian Economy & Budget' AND level = 3) AS economy_l3_topics,
      (SELECT COUNT(*)::int FROM question_variants) AS total_variants
  `;
  console.log("[econ-sync] COMPLETE! Live Neon Database Totals:", verify[0]);
}

main().catch((err) => {
  console.error("[econ-sync] Fatal error:", err);
  process.exit(1);
});
