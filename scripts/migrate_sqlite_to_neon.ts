import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

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
    // Fallback below
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

function mapSubjectToTopicId(subjectRaw: string | null, topicRaw: string | null): { subject: string; topicId: string } {
  const combined = `${subjectRaw || ""} ${topicRaw || ""}`.toLowerCase();
  if (combined.includes("panchayat") || combined.includes("local") || combined.includes("73rd")) {
    return { subject: "Indian Polity & Governance", topicId: "top-polity-panchayat" };
  }
  if (combined.includes("urban") || combined.includes("municipal") || combined.includes("74th")) {
    return { subject: "Indian Polity & Governance", topicId: "top-polity-ulb" };
  }
  if (combined.includes("polity") || combined.includes("constitution") || combined.includes("parliament") || combined.includes("article") || combined.includes("judiciar")) {
    return { subject: "Indian Polity & Governance", topicId: "top-polity-const-bodies" };
  }
  if (combined.includes("econom") || combined.includes("budget") || combined.includes("fiscal") || combined.includes("bank") || combined.includes("rbi") || combined.includes("poverty")) {
    return { subject: "Indian Economy & Budget", topicId: "top-econ-fiscal" };
  }
  if (combined.includes("environ") || combined.includes("ecolog") || combined.includes("biodivers") || combined.includes("climate") || combined.includes("ramsar") || combined.includes("wildlife")) {
    return { subject: "Environment & Ecology", topicId: "top-env-biodiversity" };
  }
  if (combined.includes("geograph") || combined.includes("river") || combined.includes("monsoon") || combined.includes("mineral") || combined.includes("soil") || combined.includes("drainage")) {
    return { subject: "Indian & World Geography", topicId: "top-geo-rivers" };
  }
  if (combined.includes("up ") || combined.includes("uttar pradesh") || combined.includes("census")) {
    return { subject: "UP Special GK & Census", topicId: "top-up-special-gk" };
  }
  if (combined.includes("science") || combined.includes("physics") || combined.includes("chem") || combined.includes("biolog") || combined.includes("vitamin") || combined.includes("space") || combined.includes("agricult") || combined.includes("kvk")) {
    return { subject: "General Science & Tech", topicId: "top-sci-bio-agri" };
  }
  if (combined.includes("current") || combined.includes("scheme") || combined.includes("index") || combined.includes("summit")) {
    return { subject: "Current Affairs & Schemes", topicId: "top-ca-schemes" };
  }
  return { subject: "Modern & Ancient History", topicId: "top-hist-modern" };
}

async function main() {
  const directUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!directUrl) throw new Error("Missing DATABASE_URL_UNPOOLED / DATABASE_URL");
  const sql = neon(directUrl);

  console.log("[seed] 1/6 Seeding UPPSC Canonical Exams...");
  const canonicalExams = [
    {
      id: "uppcs-prelims",
      slug: "uppcs-prelims-2026",
      nameEn: "UPPCS Combined State (Prelims)",
      nameHi: "यूपीपीसीएस संयुक्त राज्य (प्रारंभिक परीक्षा)",
      shortEn: "UPPCS Prelims 2026",
      shortHi: "यूपीपीसीएस प्रा. 2026",
      descEn: "GS Paper I (150 Qs) & CSAT • +1.33 / -0.44 Marking • Official PYQs & Concept Drills",
      descHi: "सामान्य अध्ययन प्रश्नपत्र-I (150 प्रश्न) • +1.33 / -0.44 अंकन • आधिकारिक विगत प्रश्न एवं अभ्यास",
      totalQ: 150,
      maxMarks: 200,
      duration: 120,
      pos: 1.3333,
      negRatio: 0.3333,
      cutoff: 88.4,
      cycle: "2026 Cycle",
      days: 182,
    },
    {
      id: "uppsc-ro-aro",
      slug: "uppsc-ro-aro-2026",
      nameEn: "UPPSC RO / ARO (Samiksha Adhikari)",
      nameHi: "यूपीपीएससी आरओ / एआरओ (समीक्षा अधिकारी)",
      shortEn: "UPPSC RO / ARO",
      shortHi: "आरओ / एआरओ",
      descEn: "General Studies (140 Qs) + General Hindi (60 Qs) • 1/3rd Negative Marking",
      descHi: "सामान्य अध्ययन (140 प्रश्न) + सामान्य हिन्दी (60 प्रश्न) • 1/3 नकारात्मक अंकन",
      totalQ: 140,
      maxMarks: 140,
      duration: 120,
      pos: 1.0,
      negRatio: 0.3333,
      cutoff: 122.0,
      cycle: "Upcoming Cycle",
      days: 145,
    },
    {
      id: "uppsc-acf-rfo",
      slug: "uppsc-acf-rfo-2026",
      nameEn: "UPPSC ACF / RFO (Forest Officer)",
      nameHi: "यूपीपीएससी एसीएफ / आरएफओ (वन संरक्षक)",
      shortEn: "UPPSC ACF / RFO",
      shortHi: "एसीएफ / आरएफओ",
      descEn: "General Studies & Forestry / Environment Specialization • Strict Cutoffs",
      descHi: "सामान्य अध्ययन एवं पर्यावरण/वानिकी विशेषज्ञता • उच्च कटऑफ मानक",
      totalQ: 150,
      maxMarks: 200,
      duration: 120,
      pos: 1.3333,
      negRatio: 0.3333,
      cutoff: 108.5,
      cycle: "2026 Cycle",
      days: 195,
    },
    {
      id: "uppsc-gic-beo",
      slug: "uppsc-gic-beo-screening",
      nameEn: "UPPSC GIC Lecturer & BEO Screening",
      nameHi: "यूपीपीएससी जीआईसी प्रवक्ता एवं बीईओ स्क्रीनिंग",
      shortEn: "GIC & BEO Screening",
      shortHi: "जीआईसी / बीईओ",
      descEn: "General Studies Screening Blueprint (40–120 Qs) + Core Subject Foundation",
      descHi: "सामान्य अध्ययन स्क्रीनिंग प्रश्नपत्र + मुख्य विषय आधार",
      totalQ: 120,
      maxMarks: 300,
      duration: 120,
      pos: 2.5,
      negRatio: 0.3333,
      cutoff: 168.0,
      cycle: "2026 Screening",
      days: 120,
    },
  ];

  for (const e of canonicalExams) {
    await sql`
      INSERT INTO exams (
        id, slug, name_en, name_hi, short_name_en, short_name_hi,
        description_en, description_hi, total_questions, max_marks,
        duration_mins, positive_marks, negative_marking_ratio,
        historical_cutoff, target_cycle_label, days_remaining
      ) VALUES (
        ${e.id}, ${e.slug}, ${e.nameEn}, ${e.nameHi}, ${e.shortEn}, ${e.shortHi},
        ${e.descEn}, ${e.descHi}, ${e.totalQ}, ${e.maxMarks},
        ${e.duration}, ${e.pos}, ${e.negRatio},
        ${e.cutoff}, ${e.cycle}, ${e.days}
      )
      ON CONFLICT (id) DO UPDATE SET
        name_en = EXCLUDED.name_en,
        name_hi = EXCLUDED.name_hi,
        description_en = EXCLUDED.description_en,
        description_hi = EXCLUDED.description_hi
    `;
  }

  console.log("[seed] 2/6 Seeding 3-Tier Canonical Syllabus Hierarchy & Cross-Exam Weights...");
  const topics = [
    // Level 1 Domains
    { id: "dom-polity", slug: "polity", parent: null, level: 1, key: "Indian Polity & Governance", en: "Indian Polity & Governance", hi: "भारतीय राजव्यवस्था एवं शासन", descEn: "Constitutional framework, local self-government, Parliament & bodies", descHi: "संवैधानिक ढांचा, स्थानीय स्वशासन, संसद एवं संवैधानिक निकाय", hy: true, order: 1 },
    { id: "dom-history", slug: "history", parent: null, level: 1, key: "Modern & Ancient History", en: "Modern & Ancient Indian History", hi: "आधुनिक एवं प्राचीन भारतीय इतिहास", descEn: "1857 Revolt, National Movement, Socio-religious reforms & Culture", descHi: "1857 का विद्रोह, राष्ट्रीय आंदोलन, सामाजिक सुधार एवं संस्कृति", hy: true, order: 2 },
    { id: "dom-geography", slug: "geography", parent: null, level: 1, key: "Indian & World Geography", en: "Indian & World Geography", hi: "भारत एवं विश्व का भूगोल", descEn: "Drainage systems, monsoon, resources, mountain passes & mapping", descHi: "अपवाह तंत्र, मानसून, खनिज संसाधन एवं विश्व मानचित्रण", hy: true, order: 3 },
    { id: "dom-economy", slug: "economy", parent: null, level: 1, key: "Indian Economy & Budget", en: "Indian Economy & Sustainable Development", hi: "भारतीय अर्थव्यवस्था एवं बजट", descEn: "Fiscal policy, FRBM, RBI banking, Union & UP State Budget, SDGs", descHi: "राजकोषीय नीति, एफआरबीएम, बैंकिंग, केंद्रीय एवं उ.प्र. बजट", hy: true, order: 4 },
    { id: "dom-environment", slug: "environment", parent: null, level: 1, key: "Environment & Ecology", en: "Environment, Ecology & Biodiversity", hi: "पर्यावरण, पारिस्थितिकी एवं जैव-विविधता", descEn: "National parks, Ramsar wetlands, climate treaties & acts", descHi: "राष्ट्रीय उद्यान, रामसर आर्द्रभूमि, जलवायु समझौते एवं अधिनियम", hy: true, order: 5 },
    { id: "dom-science", slug: "science", parent: null, level: 1, key: "General Science & Tech", en: "General Science, Agriculture & Tech", hi: "सामान्य विज्ञान, कृषि एवं प्रौद्योगिकी", descEn: "Human physiology, nutrition, KVKs, space & everyday physics", descHi: "मानव शरीर क्रिया, पोषण, कृषि विज्ञान केंद्र एवं अंतरिक्ष", hy: false, order: 6 },
    { id: "dom-up-special", slug: "up-special", parent: null, level: 1, key: "UP Special GK & Census", en: "UP Special GK, Census & Culture", hi: "उत्तर प्रदेश विशेष एवं जनगणना", descEn: "UP districts, ODOP, sanctuaries, tribes, 2011 Census & welfare", descHi: "उ.प्र. जिले, ओडीओपी, वन्यजीव विहार, जनजातियां एवं जनगणना", hy: true, order: 7 },
    { id: "dom-ca", slug: "current-affairs", parent: null, level: 1, key: "Current Affairs & Schemes", en: "National & International Current Affairs", hi: "राष्ट्रीय एवं अंतर्राष्ट्रीय समसामयिकी", descEn: "Flagship government schemes, indices, summits & awards", descHi: "प्रमुख सरकारी योजनाएं, सूचकांक, सम्मेलन एवं पुरस्कार", hy: true, order: 8 },

    // Level 2 Modules
    { id: "mod-polity-local", slug: "polity-local-govt", parent: "dom-polity", level: 2, key: "Indian Polity & Governance", en: "Local Self-Government & Decentralization", hi: "स्थानीय स्वशासन एवं विकेंद्रीकरण", descEn: "73rd & 74th Amendments, PRIs, ULBs & Fifth Schedule", descHi: "73वां एवं 74वां संशोधन, पंचायती राज एवं नगर निकाय", hy: true, order: 1 },
    { id: "mod-polity-bodies", slug: "polity-bodies", parent: "dom-polity", level: 2, key: "Indian Polity & Governance", en: "Constitutional Bodies & Parliament", hi: "संवैधानिक निकाय एवं संसद", descEn: "EC, CAG, UPSC, Finance Commission, Fundamental Rights & Writs", descHi: "निर्वाचन आयोग, सीएजी, वित्त आयोग, मूल अधिकार एवं रिट", hy: true, order: 2 },
    { id: "mod-econ-public", slug: "econ-public-finance", parent: "dom-economy", level: 2, key: "Indian Economy & Budget", en: "Public Finance, Fiscal Policy & Banking", hi: "लोक वित्त, राजकोषीय नीति एवं बैंकिंग", descEn: "Deficit types, FRBM Act, Monetary Policy Committee & Inflation", descHi: "घाटे के प्रकार, एफआरबीएम अधिनियम, मौद्रिक नीति एवं मुद्रास्फीति", hy: true, order: 1 },
    { id: "mod-hist-national", slug: "hist-national-movement", parent: "dom-history", level: 2, key: "Modern & Ancient History", en: "Freedom Struggle & Peasant Movements", hi: "स्वतंत्रता संग्राम एवं किसान आंदोलन", descEn: "INC sessions, Gandhian movements, Kisan Sabhas & Chronology", descHi: "कांग्रेस अधिवेशन, गांधीवादी आंदोलन एवं किसान सभाएं", hy: true, order: 1 },
    { id: "mod-geo-india", slug: "geo-indian-physical", parent: "dom-geography", level: 2, key: "Indian & World Geography", en: "Physical Geography & River Systems", hi: "भौतिक भूगोल एवं नदी तंत्र", descEn: "Himalayan & Peninsular tributaries, dams & passes", descHi: "हिमालयी एवं प्रायद्वीपीय नदियां, बांध एवं दर्रे", hy: true, order: 1 },
    { id: "mod-env-cons", slug: "env-conservation", parent: "dom-environment", level: 2, key: "Environment & Ecology", en: "Protected Areas, Wetlands & Treaties", hi: "संरक्षित क्षेत्र, आर्द्रभूमि एवं संधियां", descEn: "Ramsar sites, Biosphere Reserves, Wildlife Protection Act 1972", descHi: "रामसर स्थल, बायोस्फीयर रिजर्व एवं वन्यजीव संरक्षण अधिनियम", hy: true, order: 1 },
    { id: "mod-sci-applied", slug: "sci-applied-bio", parent: "dom-science", level: 2, key: "General Science & Tech", en: "Biology, Nutrition & Agricultural Institutions", hi: "जीव विज्ञान, पोषण एवं कृषि संस्थान", descEn: "Vitamins, diseases, KVKs, ICAR & crop science", descHi: "विटामिन, मानव रोग, कृषि विज्ञान केंद्र एवं फसल विज्ञान", hy: false, order: 1 },
    { id: "mod-up-core", slug: "up-core-gk", parent: "dom-up-special", level: 2, key: "UP Special GK & Census", en: "UP Geography, Census & State Schemes", hi: "उ.प्र. भूगोल, जनगणना एवं राज्य योजनाएं", descEn: "UP Ramsar sites, ODOP districts, literacy & demographics", descHi: "उ.प्र. रामसर स्थल, एक जिला एक उत्पाद एवं जनसांख्यिकी", hy: true, order: 1 },
    { id: "mod-ca-core", slug: "ca-flagship", parent: "dom-ca", level: 2, key: "Current Affairs & Schemes", en: "Union Schemes & Global Indices", hi: "केंद्रीय योजनाएं एवं वैश्विक सूचकांक", descEn: "Flagship ministries, rankings & bilateral exercises", descHi: "प्रमुख मंत्रालय, वैश्विक रैंकिंग एवं सैन्य अभ्यास", hy: true, order: 1 },

    // Level 3 Micro-Topics
    { id: "top-polity-panchayat", slug: "panchayati-raj-73rd", parent: "mod-polity-local", level: 3, key: "Indian Polity & Governance", en: "Panchayati Raj (73rd Amendment & Committees)", hi: "पंचायती राज (73वां संशोधन एवं समितियां)", descEn: "Balwant Rai, Ashok Mehta, GVK Rao, LM Singhvi, Art 243–243O & 11th Schedule", descHi: "बलवंत राय, अशोक मेहता, एल.एम. सिंघवी समिति, अनुच्छेद 243 एवं 11वीं अनुसूची", hy: true, order: 1 },
    { id: "top-polity-ulb", slug: "urban-local-bodies-74th", parent: "mod-polity-local", level: 3, key: "Indian Polity & Governance", en: "Urban Local Bodies (74th Amendment & 12th Schedule)", hi: "नगरीय स्थानीय निकाय (74वां संशोधन एवं 12वीं अनुसूची)", descEn: "Municipalities, Ward Committees, Art 243P–243ZG & 18 Functional Items", descHi: "नगर पालिकाएं, वार्ड समितियां, अनुच्छेद 243P–243ZG एवं 18 विषय", hy: false, order: 2 },
    { id: "top-polity-pesa", slug: "pesa-fifth-schedule", parent: "mod-polity-local", level: 3, key: "Indian Polity & Governance", en: "PESA Act 1996 & Fifth Schedule Tribal Areas", hi: "पेसा अधिनियम 1996 एवं पांचवीं अनुसूची क्षेत्र", descEn: "Bhuria Committee, Gram Sabha powers over minor forest produce", descHi: "भूरिया समिति, लघु वनोपज पर ग्राम सभा के अधिकार", hy: true, order: 3 },
    { id: "top-polity-const-bodies", slug: "constitutional-bodies-articles", parent: "mod-polity-bodies", level: 3, key: "Indian Polity & Governance", en: "Constitutional Bodies, Fundamental Rights & Parliament", hi: "संवैधानिक निकाय, मूल अधिकार एवं संसद", descEn: "Art 280 Finance Commission, CAG, EC, Writs (Art 32/226) & Parliamentary Motions", descHi: "अनुच्छेद 280 वित्त आयोग, निर्वाचन आयोग, रिट एवं संसदीय प्रक्रिया", hy: true, order: 4 },
    { id: "top-econ-fiscal", slug: "fiscal-policy-frbm", parent: "mod-econ-public", level: 3, key: "Indian Economy & Budget", en: "Fiscal Policy, FRBM Act & Union/UP Budget", hi: "राजकोषीय नीति, एफआरबीएम अधिनियम एवं बजट", descEn: "Effective Revenue Deficit, Primary Deficit, RBI tools & Tax devolution", descHi: "प्रभावी राजस्व घाटा, प्राथमिक घाटा, आरबीआई उपकरण एवं कर हस्तांतरण", hy: true, order: 5 },
    { id: "top-hist-modern", slug: "modern-history-movements", parent: "mod-hist-national", level: 3, key: "Modern & Ancient History", en: "National Movement, Peasant Sabhas & Chronology", hi: "राष्ट्रीय आंदोलन, किसान सभाएं एवं कालक्रम", descEn: "1857 centres, Tebhaga/Eka movements, INC acts & treaties", descHi: "1857 के केंद्र, तेभागा व एका आंदोलन, कांग्रेस अधिवेशन एवं संधियां", hy: true, order: 6 },
    { id: "top-geo-rivers", slug: "drainage-peninsular-rivers", parent: "mod-geo-india", level: 3, key: "Indian & World Geography", en: "Drainage System, Peninsular Rivers & Passes", hi: "अपवाह तंत्र, प्रायद्वीपीय नदियां एवं दर्रे", descEn: "Yamuna/Ganga confluence order, Godavari/Krishna tributaries & world straits", descHi: "गंगा-यमुना सहायक नदियां, गोदावरी-कृष्णा तंत्र एवं जलसंधियां", hy: true, order: 7 },
    { id: "top-env-biodiversity", slug: "ramsar-biodiversity-treaties", parent: "mod-env-cons", level: 3, key: "Environment & Ecology", en: "Ramsar Wetlands, National Parks & Climate Protocols", hi: "रामसर आर्द्रभूमि, राष्ट्रीय उद्यान एवं जलवायु प्रोटोकॉल", descEn: "Montreal, Kyoto, Paris, CBD, Wildlife Act schedules & UP sanctuaries", descHi: "मॉन्ट्रियल, क्योटो, पेरिस समझौता एवं वन्यजीव संरक्षण अनुसूचियां", hy: true, order: 8 },
    { id: "top-sci-bio-agri", slug: "biology-agriculture-kvk", parent: "mod-sci-applied", level: 3, key: "General Science & Tech", en: "Human Biology, Vitamins & Krishi Vigyan Kendras (KVK)", hi: "मानव जीव विज्ञान, विटामिन एवं कृषि विज्ञान केंद्र (KVK)", descEn: "Deficiency diseases, hormones, ICAR institutions & KVK history", descHi: "विटामिन की कमी से रोग, हार्मोन, आईसीएआर एवं केवीके इतिहास", hy: false, order: 9 },
    { id: "top-up-special-gk", slug: "up-special-odop-census", parent: "mod-up-core", level: 3, key: "UP Special GK & Census", en: "UP Special Districts, ODOP, Wetlands & Census 2011", hi: "उ.प्र. विशेष: जिले, ओडीओपी, आर्द्रभूमि एवं जनगणना 2011", descEn: "Bakhira & Haiderpur wetlands, UP agro-climatic zones & literacy", descHi: "बखीरा व हैदरपुर आर्द्रभूमि, उ.प्र. कृषि-जलवायु क्षेत्र एवं साक्षरता", hy: true, order: 10 },
    { id: "top-ca-schemes", slug: "flagship-schemes-indices", parent: "mod-ca-core", level: 3, key: "Current Affairs & Schemes", en: "Flagship Welfare Schemes, Reports & Global Indices", hi: "प्रमुख कल्याणकारी योजनाएं, रिपोर्ट एवं वैश्विक सूचकांक", descEn: "UNDP HDI, NITI Aayog SDG India Index & central sector schemes", descHi: "मानव विकास सूचकांक, नीति आयोग एसडीजी इंडेक्स एवं केंद्रीय योजनाएं", hy: true, order: 11 },
  ];

  for (const t of topics) {
    await sql`
      INSERT INTO syllabus_topics (
        id, slug, parent_id, level, subject_key, name_en, name_hi,
        description_en, description_hi, is_high_yield, sort_order
      ) VALUES (
        ${t.id}, ${t.slug}, ${t.parent}, ${t.level}, ${t.key}, ${t.en}, ${t.hi},
        ${t.descEn}, ${t.descHi}, ${t.hy}, ${t.order}
      )
      ON CONFLICT (id) DO UPDATE SET
        name_en = EXCLUDED.name_en,
        name_hi = EXCLUDED.name_hi,
        description_en = EXCLUDED.description_en,
        description_hi = EXCLUDED.description_hi
    `;
  }

  // Distinct per-exam syllabus weightage profiles (L3 micro-topics)
  const weightMatrix: Record<string, Array<[string, number, string]>> = {
    "uppcs-prelims": [
      ["top-polity-panchayat", 7, "HIGH_YIELD"],
      ["top-polity-ulb", 3, "CORE"],
      ["top-polity-pesa", 2, "CORE"],
      ["top-polity-const-bodies", 8, "HIGH_YIELD"],
      ["top-hist-modern", 20, "HIGH_YIELD"],
      ["top-geo-rivers", 16, "HIGH_YIELD"],
      ["top-econ-fiscal", 15, "HIGH_YIELD"],
      ["top-env-biodiversity", 12, "HIGH_YIELD"],
      ["top-sci-bio-agri", 7, "CORE"],
      ["top-up-special-gk", 6, "HIGH_YIELD"],
      ["top-ca-schemes", 4, "CORE"],
    ],
    "uppsc-ro-aro": [
      ["top-polity-panchayat", 9, "HIGH_YIELD"],
      ["top-polity-const-bodies", 14, "HIGH_YIELD"],
      ["top-hist-modern", 22, "HIGH_YIELD"],
      ["top-up-special-gk", 18, "HIGH_YIELD"],
      ["top-sci-bio-agri", 12, "CORE"],
      ["top-geo-rivers", 10, "CORE"],
      ["top-econ-fiscal", 6, "PERIPHERAL"],
      ["top-env-biodiversity", 5, "PERIPHERAL"],
      ["top-ca-schemes", 4, "CORE"],
    ],
    "uppsc-acf-rfo": [
      ["top-env-biodiversity", 34, "HIGH_YIELD"],
      ["top-geo-rivers", 20, "HIGH_YIELD"],
      ["top-econ-fiscal", 14, "CORE"],
      ["top-polity-pesa", 8, "HIGH_YIELD"],
      ["top-sci-bio-agri", 10, "HIGH_YIELD"],
      ["top-polity-panchayat", 4, "PERIPHERAL"],
      ["top-hist-modern", 6, "PERIPHERAL"],
      ["top-up-special-gk", 4, "CORE"],
    ],
    "uppsc-gic-beo": [
      ["top-hist-modern", 24, "HIGH_YIELD"],
      ["top-sci-bio-agri", 18, "HIGH_YIELD"],
      ["top-polity-const-bodies", 16, "HIGH_YIELD"],
      ["top-up-special-gk", 16, "HIGH_YIELD"],
      ["top-polity-panchayat", 8, "CORE"],
      ["top-geo-rivers", 10, "CORE"],
      ["top-econ-fiscal", 8, "PERIPHERAL"],
    ],
  };

  for (const [examId, entries] of Object.entries(weightMatrix)) {
    for (const [topicId, weight, tier] of entries) {
      const mapId = `${examId}__${topicId}`;
      await sql`
        INSERT INTO exam_syllabus_map (id, exam_id, topic_id, expected_weight_pct, priority_tier)
        VALUES (${mapId}, ${examId}, ${topicId}, ${weight}, ${tier})
        ON CONFLICT (exam_id, topic_id) DO UPDATE SET
          expected_weight_pct = EXCLUDED.expected_weight_pct,
          priority_tier = EXCLUDED.priority_tier
      `;
    }
  }

  console.log("[seed] 3/6 Syncing Papers & Harvested Bilingual Questions from harvester.db (Read-Only)...");
  const sqlitePath = path.resolve("harvester/data/harvester.db");
  let syncedPapers = 0;
  let syncedQuestions = 0;

  if (fs.existsSync(sqlitePath)) {
    const sqlite = new DatabaseSync(sqlitePath, { open: true, readOnly: true });

    const rawPapers = sqlite
      .prepare(
        `SELECT id, exam_name, paper_name, stage, paper_code, year, series, has_official_key
         FROM exam_papers
         WHERE document_type = 'QUESTION_PAPER'
         ORDER BY year DESC NULLS LAST
         LIMIT 60`
      )
      .all() as Array<any>;

    const validPaperIds = new Set<string>();
    for (const p of rawPapers) {
      const examLower = String(p.exam_name || "").toLowerCase();
      let mappedExamId = "uppcs-prelims";
      if (examLower.includes("ro") || examLower.includes("samiksha")) mappedExamId = "uppsc-ro-aro";
      else if (examLower.includes("acf") || examLower.includes("rfo") || examLower.includes("forest")) mappedExamId = "uppsc-acf-rfo";
      else if (examLower.includes("gic") || examLower.includes("beo") || examLower.includes("lecturer")) mappedExamId = "uppsc-gic-beo";

      const titleEn = String(p.paper_name || `${p.exam_name} ${p.year || ""}`).trim();
      const titleHi = `${titleEn} (आधिकारिक प्रश्नपत्र)`;

      await sql`
        INSERT INTO exam_papers (
          id, exam_id, exam_name, paper_name_en, paper_name_hi,
          paper_code, stage, year, series, paper_type, has_official_key
        ) VALUES (
          ${p.id}, ${mappedExamId}, ${p.exam_name}, ${titleEn}, ${titleHi},
          ${p.paper_code}, ${p.stage || "PRELIMS"}, ${p.year}, ${p.series},
          'OFFICIAL_PYQ', ${Boolean(p.has_official_key)}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      validPaperIds.add(String(p.id));
      syncedPapers++;
    }

    // Pull verified/staged bilingual questions (prioritizing rich bilingual stems + explanations)
    const tableCheck = sqlite
      .prepare(`SELECT COUNT(*) as cnt FROM questions`)
      .get() as { cnt: number };
    const stagedCheck = sqlite
      .prepare(`SELECT COUNT(*) as cnt FROM staged_questions`)
      .get() as { cnt: number };

    console.log(`[seed] Found in harvester.db -> questions: ${tableCheck.cnt}, staged_questions: ${stagedCheck.cnt}`);

    const sourceTable = tableCheck.cnt > 0 ? "questions" : "staged_questions";
    const rawQuestions = sqlite
      .prepare(
        `SELECT id, paper_id, question_number, subject, topic, difficulty, language,
                question_en, question_hi, options_json, correct_option,
                explanation_en, explanation_hi, source_key_type, confidence_score, content_hash
         FROM ${sourceTable}
         WHERE question_en IS NOT NULL AND length(question_en) > 12
         ORDER BY CASE WHEN question_hi IS NOT NULL AND explanation_en IS NOT NULL THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1200`
      )
      .all() as Array<any>;

    const chunkSize = 80;
    for (let i = 0; i < rawQuestions.length; i += chunkSize) {
      const batch = rawQuestions.slice(i, i + chunkSize);
      const valuesPlaceholder: string[] = [];
      const params: any[] = [];
      let pIdx = 1;

      for (const q of batch) {
        const { optionsEn, optionsHi } = parseOptions(String(q.options_json || "[]"));
        const { subject, topicId } = mapSubjectToTopicId(q.subject, q.topic);
        const fmt = detectQuestionFormat(String(q.question_en));
        const paperRef = q.paper_id && validPaperIds.has(String(q.paper_id)) ? String(q.paper_id) : null;
        const langCov = q.question_hi && optionsHi ? "BILINGUAL" : "EN";
        const corr = ["A", "B", "C", "D", "X"].includes(String(q.correct_option || "").toUpperCase())
          ? String(q.correct_option).toUpperCase()
          : "A";
        const diff = ["EASY", "MEDIUM", "HARD"].includes(String(q.difficulty || "").toUpperCase())
          ? String(q.difficulty).toUpperCase()
          : "MEDIUM";

        valuesPlaceholder.push(
          `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, 'PYQ', $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}::jsonb, $${pIdx++}::jsonb, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
        );
        params.push(
          String(q.id),
          paperRef,
          topicId,
          q.question_number ?? null,
          subject,
          q.topic ?? null,
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
          Number(q.confidence_score ?? 0.9),
          q.content_hash ? String(q.content_hash) : null,
          "VERIFIED"
        );
      }

      const insertSql = `
        INSERT INTO questions (
          id, paper_id, topic_id, question_number, subject, topic_raw, difficulty,
          question_origin, question_format, language_coverage, question_en, question_hi,
          options_en, options_hi, correct_option, explanation_en, explanation_hi,
          source_key_type, confidence_score, content_hash, status
        ) VALUES ${valuesPlaceholder.join(", ")}
        ON CONFLICT (id) DO NOTHING
      `;
      await sql.query(insertSql, params);
      syncedQuestions += batch.length;
    }

    sqlite.close();
  }

  console.log(`[seed] Synced ${syncedPapers} official papers and ${syncedQuestions} harvested PYQs.`);

  console.log("[seed] 4/6 Seeding Flagship Curated PYQs, Concept Builders, NCERT Drills & Official Papers...");
  await sql`
    INSERT INTO exam_papers (
      id, exam_id, exam_name, paper_name_en, paper_name_hi,
      paper_code, stage, year, series, paper_type, has_official_key, total_questions, max_marks, duration_mins
    ) VALUES
      ('paper-uppcs-2025-gs1', 'uppcs-prelims', 'UPPCS Prelims', 'UPPCS Prelims 2025 — General Studies Paper-I', 'यूपीपीसीएस प्रारंभिक परीक्षा 2025 — सामान्य अध्ययन प्रश्नपत्र-I', 'GS-I', 'PRELIMS', 2025, 'A', 'OFFICIAL_PYQ', TRUE, 150, 200, 120),
      ('paper-uppcs-2024-gs1', 'uppcs-prelims', 'UPPCS Prelims', 'UPPCS Prelims 2024 — General Studies Paper-I', 'यूपीपीसीएस प्रारंभिक परीक्षा 2024 — सामान्य अध्ययन प्रश्नपत्र-I', 'GS-I', 'PRELIMS', 2024, 'A', 'OFFICIAL_PYQ', TRUE, 150, 200, 120),
      ('paper-sankalp-mock-04', 'uppcs-prelims', 'Sankalp Originals', 'Sankalp Concept Mock #04 (UP Budget & Core GS)', 'संकल्प कॉन्सेप्ट मॉक #04 (उ.प्र. बजट एवं सामान्य अध्ययन)', 'MOCK-04', 'PRELIMS', 2026, 'S1', 'CONCEPT_MOCK', TRUE, 150, 200, 120)
    ON CONFLICT (id) DO NOTHING
  `;

  // Flagship curated bilingual questions covering PYQ + CONCEPT_BUILDER + NCERT_DRILL + Repeated Variants
  const flagshipQuestions = [
    {
      id: "q-flagship-ashok-mehta",
      paperId: "paper-uppcs-2025-gs1",
      topicId: "top-polity-panchayat",
      qNo: 42,
      subject: "Indian Polity & Governance",
      diff: "MEDIUM",
      origin: "PYQ",
      fmt: "MULTI_STATEMENT",
      qEn: "With reference to the recommendations of the Ashok Mehta Committee (1977) on Panchayati Raj Institutions in India, consider the following statements:\n1. The three-tier system of Panchayati Raj should be replaced by a two-tier system consisting of Zila Parishad at the district level and Mandal Panchayat at the cluster level.\n2. Nyaya Panchayats should be kept as separate bodies from developmental panchayats and presided over by a qualified judge.\n3. There should be no official participation of political parties at any tier of Panchayat elections.\nWhich of the statements given above is/are correct?",
      qHi: "भारत में पंचायती राज संस्थाओं पर अशोक मेहता समिति (1977) की सिफारिशों के संदर्भ में, निम्नलिखित कथनों पर विचार कीजिए:\n1. पंचायती राज की त्रि-स्तरीय प्रणाली के स्थान पर जिला स्तर पर जिला परिषद और क्लस्टर स्तर पर मंडल पंचायत वाली द्वि-स्तरीय प्रणाली स्थापित की जानी चाहिए।\n2. न्याय पंचायतों को विकास पंचायतों से अलग निकाय के रूप में रखा जाना चाहिए और उनकी अध्यक्षता एक योग्य न्यायाधीश द्वारा की जानी चाहिए।\n3. पंचायत चुनावों के किसी भी स्तर पर राजनीतिक दलों की कोई आधिकारिक भागीदारी नहीं होनी चाहिए।\nउपर्युक्त कथनों में से कौन-सा/से सही है/हैं?",
      optEn: [
        { key: "A", text: "1 and 2 only" },
        { key: "B", text: "2 and 3 only" },
        { key: "C", text: "1 only" },
        { key: "D", text: "1, 2 and 3" },
      ],
      optHi: [
        { key: "A", text: "केवल 1 और 2" },
        { key: "B", text: "केवल 2 और 3" },
        { key: "C", text: "केवल 1" },
        { key: "D", text: "1, 2 और 3" },
      ],
      ans: "A",
      expEn: "Statements 1 and 2 are correct: Ashok Mehta Committee (1977) recommended replacing the 3-tier system with a 2-tier system (Zila Parishad + Mandal Panchayat for 15,000–20,000 population) and separate Nyaya Panchayats headed by a qualified judge. Statement 3 is incorrect because Ashok Mehta Committee explicitly recommended OPEN official participation of political parties at all levels of Panchayat elections.",
      expHi: "कथन 1 और 2 सही हैं: अशोक मेहता समिति (1977) ने त्रि-स्तरीय प्रणाली के स्थान पर द्वि-स्तरीय प्रणाली (जिला परिषद और मंडल पंचायत) तथा योग्य न्यायाधीश की अध्यक्षता में पृथक न्याय पंचायत की सिफारिश की थी। कथन 3 गलत है क्योंकि इस समिति ने सभी स्तरों के पंचायत चुनावों में राजनीतिक दलों की खुली और आधिकारिक भागीदारी की सिफारिश की थी।",
      ruleEn: "Ashok Mehta (1977) = 2-Tier + OPEN Political Party Participation + Nyaya Panchayats + Compulsory Taxation Powers.",
      ruleHi: "अशोक मेहता (1977) = द्वि-स्तरीय प्रणाली + राजनीतिक दलों की खुली भागीदारी + पृथक न्याय पंचायत + अनिवार्य कराधान शक्तियां।",
      keyType: "OFFICIAL_FINAL",
    },
    {
      id: "q-flagship-kvk-115",
      paperId: "paper-uppcs-2025-gs1",
      topicId: "top-sci-bio-agri",
      qNo: 115,
      subject: "General Science & Tech",
      diff: "MEDIUM",
      origin: "PYQ",
      fmt: "MULTI_STATEMENT",
      qEn: "With reference to 'Krishi Vigyan Kendras (KVK)', consider the following statements:\n1. India's first Krishi Vigyan Kendra was established in 1974 at Puducherry under the administrative control of Tamil Nadu Agricultural University (TNAU).\n2. The KVK scheme is a 100% centrally financed scheme by the Government of India under the Indian Council of Agricultural Research (ICAR).\nWhich of the statements given above is/are correct?",
      qHi: "“कृषि विज्ञान केंद्र (के.वी.के. / KVK)” के संदर्भ में, निम्नलिखित कथनों पर विचार कीजिए:\n1. भारत का पहला कृषि विज्ञान केंद्र वर्ष 1974 में तमिलनाडु कृषि विश्वविद्यालय (TNAU) के प्रशासनिक नियंत्रण में पुडुचेरी में स्थापित किया गया था।\n2. केवीके योजना भारतीय कृषि अनुसंधान परिषद (ICAR) के अंतर्गत भारत सरकार द्वारा 100% केंद्रीय वित्तपोषित योजना है।\nउपर्युक्त कथनों में से कौन-सा/से सही है/हैं?",
      optEn: [
        { key: "A", text: "Both 1 and 2" },
        { key: "B", text: "2 only" },
        { key: "C", text: "Neither 1 nor 2" },
        { key: "D", text: "1 only" },
      ],
      optHi: [
        { key: "A", text: "1 और 2 दोनों" },
        { key: "B", text: "केवल 2" },
        { key: "C", text: "न तो 1 और न ही 2" },
        { key: "D", text: "केवल 1" },
      ],
      ans: "A",
      expEn: "Both statements are correct. Based on the Mohan Singh Mehta Committee (1973), the first KVK was set up in 1974 at Puducherry under TNAU, Coimbatore. KVKs are 100% financed by the Government of India through ICAR for frontline agricultural extension.",
      expHi: "दोनों कथन सही हैं। मोहन सिंह मेहता समिति (1973) की सिफारिश पर भारत का पहला कृषि विज्ञान केंद्र 1974 में पुडुचेरी में TNAU के अंतर्गत स्थापित किया गया था। यह ICAR के माध्यम से 100% केंद्र सरकार द्वारा वित्तपोषित योजना है।",
      ruleEn: "First KVK = Puducherry (1974, Mohan Singh Mehta Committee, TNAU) • 100% ICAR Central Funding.",
      ruleHi: "प्रथम केवीके = पुडुचेरी (1974, मोहन सिंह मेहता समिति) • ICAR द्वारा 100% केंद्रीय वित्तपोषित।",
      keyType: "OFFICIAL_FINAL",
    },
    {
      id: "q-cb-econ-frbm",
      paperId: "paper-sankalp-mock-04",
      topicId: "top-econ-fiscal",
      qNo: 12,
      subject: "Indian Economy & Budget",
      diff: "HARD",
      origin: "CONCEPT_BUILDER",
      fmt: "MULTI_STATEMENT",
      qEn: "Consider the following statements regarding Fiscal Deficit and Effective Revenue Deficit in Union Budget accounting:\n1. Primary Deficit equals Fiscal Deficit minus interest payments on previous borrowings.\n2. Effective Revenue Deficit excludes grants given to States specifically for the creation of capital assets.\nWhich of the statements given above is/are correct?",
      qHi: "केंद्रीय बजट लेखांकन में राजकोषीय घाटे और प्रभावी राजस्व घाटे के संदर्भ में निम्नलिखित कथनों पर विचार कीजिए:\n1. प्राथमिक घाटा राजकोषीय घाटे में से पिछले ऋणों पर ब्याज भुगतान घटाने के बराबर होता है।\n2. प्रभावी राजस्व घाटे में राज्यों को पूंजीगत परिसंपत्तियों के सृजन हेतु दिए गए अनुदानों को घटा दिया जाता है।\nउपर्युक्त कथनों में से कौन-सा/से सही है/हैं?",
      optEn: [
        { key: "A", text: "1 only" },
        { key: "B", text: "2 only" },
        { key: "C", text: "Both 1 and 2" },
        { key: "D", text: "Neither 1 nor 2" },
      ],
      optHi: [
        { key: "A", text: "केवल 1" },
        { key: "B", text: "केवल 2" },
        { key: "C", text: "1 और 2 दोनों" },
        { key: "D", text: "न तो 1 और न ही 2" },
      ],
      ans: "C",
      expEn: "Both statements 1 and 2 are correct. Primary Deficit = Fiscal Deficit − Interest Payments (measuring current year's borrowing need excluding legacy debt interest). Effective Revenue Deficit = Revenue Deficit − Grants for Creation of Capital Assets (introduced in Budget 2011–12 on Rangarajan Committee's recommendation).",
      expHi: "कथन 1 और 2 दोनों सही हैं। प्राथमिक घाटा = राजकोषीय घाटा − ब्याज भुगतान। प्रभावी राजस्व घाटा = राजस्व घाटा − पूंजीगत परिसंपत्तियों के सृजन हेतु अनुदान (रंगराजन समिति की सिफारिश पर लागू)।",
      ruleEn: "Primary Deficit = Fiscal Deficit − Interest • Effective Revenue Deficit = Revenue Deficit − Capital Asset Grants.",
      ruleHi: "प्राथमिक घाटा = राजकोषीय घाटा − ब्याज भुगतान • प्रभावी राजस्व घाटा = राजस्व घाटा − पूंजीगत अनुदान।",
      keyType: "OFFICIAL_FINAL",
    },
    {
      id: "q-ncert-pesa-1996",
      paperId: "paper-sankalp-mock-04",
      topicId: "top-polity-pesa",
      qNo: 18,
      subject: "Indian Polity & Governance",
      diff: "MEDIUM",
      origin: "NCERT_DRILL",
      fmt: "SINGLE_CHOICE",
      qEn: "Under the Provisions of the Panchayats (Extension to the Scheduled Areas) Act, 1996 (PESA), the ownership of Minor Forest Produce (MFP) is vested in which body?",
      qHi: "पंचायत के प्रावधान (अनुसूचित क्षेत्रों पर विस्तार) अधिनियम, 1996 (पेसा - PESA) के अंतर्गत 'लघु वनोपज' (Minor Forest Produce) का स्वामित्व किस संस्था में निहित है?",
      optEn: [
        { key: "A", text: "State Forest Development Corporation" },
        { key: "B", text: "Gram Sabha" },
        { key: "C", text: "Zila Parishad Chairperson" },
        { key: "D", text: "Tribal Advisory Council" },
      ],
      optHi: [
        { key: "A", text: "राज्य वन विकास निगम" },
        { key: "B", text: "ग्राम सभा" },
        { key: "C", text: "जिला परिषद अध्यक्ष" },
        { key: "D", text: "जनजातीय सलाहकार परिषद" },
      ],
      ans: "B",
      expEn: "Enacted on the recommendations of the Dileep Singh Bhuria Committee (1995), PESA 1996 extends Part IX to Fifth Schedule areas across 10 states and explicitly vests the ownership of Minor Forest Produce (MFP) in the Gram Sabha.",
      expHi: "दिलीप सिंह भूरिया समिति (1995) की सिफारिश पर अधिनियमित पेसा अधिनियम 1996 पांचवीं अनुसूची के क्षेत्रों में ग्राम सभा को लघु वनोपज का स्वामित्व प्रदान करता है।",
      ruleEn: "PESA Act 1996 (Bhuria Committee) -> Fifth Schedule (10 States) -> Gram Sabha owns Minor Forest Produce.",
      ruleHi: "पेसा 1996 (भूरिया समिति) -> पांचवीं अनुसूची (10 राज्य) -> लघु वनोपज का स्वामित्व ग्राम सभा के पास।",
      keyType: "OFFICIAL_FINAL",
    },
    {
      id: "q-cb-up-ramsar",
      paperId: "paper-sankalp-mock-04",
      topicId: "top-up-special-gk",
      qNo: 27,
      subject: "UP Special GK & Census",
      diff: "EASY",
      origin: "CONCEPT_BUILDER",
      fmt: "MATCH_LIST",
      qEn: "Which of the following pairs of Ramsar Wetland Sites in Uttar Pradesh and their respective districts is INCORRECTLY matched?",
      qHi: "उत्तर प्रदेश के रामसर आर्द्रभूमि स्थलों और उनके संबंधित जिलों के निम्नलिखित युग्मों में से कौन-सा सही सुमेलित नहीं है?",
      optEn: [
        { key: "A", text: "Bakhira Wildlife Sanctuary — Sant Kabir Nagar" },
        { key: "B", text: "Saman Bird Sanctuary — Mainpuri" },
        { key: "C", text: "Parvati Arga Bird Sanctuary — Gonda" },
        { key: "D", text: "Sarsai Nawar Jheel — Hardoi" },
      ],
      optHi: [
        { key: "A", text: "बखीरा वन्यजीव अभयारण्य — संत कबीर नगर" },
        { key: "B", text: "समन पक्षी अभयारण्य — मैनपुरी" },
        { key: "C", text: "पार्वती अरगा पक्षी अभयारण्य — गोंडा" },
        { key: "D", text: "सरसई नावर झील — हरदोई" },
      ],
      ans: "D",
      expEn: "Sarsai Nawar Jheel is located in Etawah district of Uttar Pradesh, whereas Sandi Bird Sanctuary is located in Hardoi district. Bakhira (Sant Kabir Nagar), Saman (Mainpuri), and Parvati Arga (Gonda) are all correctly matched.",
      expHi: "सरसई नावर झील उत्तर प्रदेश के इटावा जिले में स्थित है, जबकि सांडी पक्षी अभयारण्य हरदोई जिले में स्थित है। अन्य सभी युग्म सही सुमेलित हैं।",
      ruleEn: "UP Ramsar Trap: Sarsai Nawar = Etawah • Sandi = Hardoi • Samaspur = Raebareli • Saman = Mainpuri.",
      ruleHi: "उ.प्र. रामसर ट्रिक: सरसई नावर = इटावा • सांडी = हरदोई • समसपुर = रायबरेली • समन = मैनपुरी।",
      keyType: "OFFICIAL_FINAL",
    },
  ];

  for (const fq of flagshipQuestions) {
    await sql`
      INSERT INTO questions (
        id, paper_id, topic_id, question_number, subject, difficulty,
        question_origin, question_format, language_coverage, question_en, question_hi,
        options_en, options_hi, correct_option, explanation_en, explanation_hi,
        golden_rule_en, golden_rule_hi, source_key_type, confidence_score, status
      ) VALUES (
        ${fq.id}, ${fq.paperId}, ${fq.topicId}, ${fq.qNo}, ${fq.subject}, ${fq.diff},
        ${fq.origin}, ${fq.fmt}, 'BILINGUAL', ${fq.qEn}, ${fq.qHi},
        ${JSON.stringify(fq.optEn)}::jsonb, ${JSON.stringify(fq.optHi)}::jsonb,
        ${fq.ans}, ${fq.expEn}, ${fq.expHi}, ${fq.ruleEn}, ${fq.ruleHi},
        ${fq.keyType}, 1.0, 'VERIFIED'
      )
      ON CONFLICT (id) DO UPDATE SET
        golden_rule_en = EXCLUDED.golden_rule_en,
        golden_rule_hi = EXCLUDED.golden_rule_hi
    `;
  }

  await sql`DELETE FROM question_variants WHERE question_id = 'q-flagship-ashok-mehta'`;
  await sql`
    INSERT INTO question_variants (question_id, paper_label_en, paper_label_hi, question_number)
    VALUES
      ('q-flagship-ashok-mehta', 'UPPSC ACF/RFO Prelims 2021', 'यूपीपीएससी एसीएफ/आरएफओ 2021', 19),
      ('q-flagship-ashok-mehta', 'UPPSC RO/ARO Prelims 2018', 'यूपीपीएससी आरओ/एआरओ 2018', 64)
  `;

  console.log("[seed] 5/6 Seeding Bilingual Learning Studio Cheat Sheets & Active-Recall Flashcards...");
  const artifacts = [
    {
      id: "cs-panchayati-raj",
      topicId: "top-polity-panchayat",
      type: "CHEAT_SHEET",
      titleEn: "High-Yield Cheat Sheet: Panchayati Raj Evolution & Constitutional Articles",
      titleHi: "उच्च-उपयोगी चीट शीट: पंचायती राज का विकास एवं संवैधानिक अनुच्छेद",
      mins: 3,
      pyqs: 24,
      srcEn: "Laxmikanth 7th Ed. & Constitution of India (Part IX Bare Act)",
      srcHi: "एम. लक्ष्मीकांत एवं भारत का संविधान (भाग IX बेयर एक्ट)",
      contentEn: {
        summary: "Directly covers 24 UPPSC Prelims, RO/ARO & ACF questions (2017–2025) across committee chronology, tier structures, and mandatory vs voluntary provisions.",
        matrixTitle: "Master Committee Comparison Matrix (1957 – 1988)",
        matrixHeaders: ["Committee & Year", "Tier Structure", "Key Examiner Trap / Landmark Recommendation", "UPPSC Frequency"],
        matrixRows: [
          ["Balwant Rai Mehta (1957)", "3-Tier (Gram, Block Samiti, Zila)", "Coined 'Democratic Decentralization'; Panchayat Samiti as executive body; first launched at Nagaur, Rajasthan (2 Oct 1959).", "Asked 7x"],
          ["Ashok Mehta (1977)", "2-Tier (Zila Parishad & Mandal)", "TRAP: Explicitly recommended OPEN participation of political parties; separate Nyaya Panchayats; compulsory taxation powers.", "Asked 6x"],
          ["G.V.K. Rao (1985)", "District-Centric Planning", "Called PRIs 'Grass without roots' due to bureaucratization; created post of District Development Commissioner (DDC).", "Asked 4x"],
          ["L.M. Singhvi (1986)", "Constitutional Shield", "First committee to demand Constitutional recognition & protection for PRIs; Gram Sabha as direct democracy.", "Asked 7x"],
        ],
        keyArticles: [
          { badge: "Article 243-A", title: "Gram Sabha", detail: "Body of all registered voters in the village electoral roll; exercises powers provided by the State Legislature.", tag: "Village Level" },
          { badge: "Article 243-D", title: "Reservation of Seats", detail: "SC/ST reservation proportional to population; NOT LESS THAN 1/3rd seats (including Chairpersons) reserved for women.", tag: "High Trap Rate" },
          { badge: "Article 243-I", title: "State Finance Commission", detail: "Constituted by the Governor every 5th year to review Panchayat finances and tax devolution.", tag: "Every 5th Year" },
          { badge: "Article 243-K", title: "State Election Commission", detail: "Superintendence & conduct of Panchayat elections; State Election Commissioner appointed by Governor, removed like High Court Judge.", tag: "Constitutional Body" },
        ],
        chronologyLock: {
          title: "CHRONOLOGY MEMORY LOCK (B → A → G → L → T)",
          chain: "Balwant Rai (1957) → Ashok Mehta (1977) → G.V.K. Rao (1985) → L.M. Singhvi (1986) → P.K. Thungon (1988)",
          rule: "Whenever UPPSC asks chronological arrangement in GS Paper-I, always verify L.M. Singhvi (1986) precedes Thungon (1988).",
        },
      },
      contentHi: {
        summary: "यह चीट शीट 2017–2025 के बीच यूपीपीसीएस, आरओ/एआरओ एवं एसीएफ में पूछे गए 24 प्रश्नों को सीधे कवर करती है।",
        matrixTitle: "प्रमुख पंचायती राज समितियां तुलनात्मक तालिका (1957 – 1988)",
        matrixHeaders: ["समिति एवं वर्ष", "स्तरीय संरचना", "परीक्षक का मुख्य ट्रैप / प्रमुख सिफारिश", "पूछे जाने की आवृत्ति"],
        matrixRows: [
          ["बलवंत राय मेहता (1957)", "त्रि-स्तरीय (ग्राम, पंचायत समिति, जिला)", "'लोकतांत्रिक विकेंद्रीकरण' के जनक; पंचायत समिति कार्यकारी निकाय; 2 अक्टूबर 1959 को नागौर (राजस्थान) से प्रारंभ।", "7 बार"],
          ["अशोक मेहता (1977)", "द्वि-स्तरीय (जिला परिषद व मंडल)", "ट्रैप: राजनीतिक दलों की खुली भागीदारी की सिफारिश; पृथक न्याय पंचायत; अनिवार्य कराधान शक्तियां।", "6 बार"],
          ["जी.वी.के. राव (1985)", "जिला-केंद्रित नियोजन", "नौकरशाही के कारण पंचायतों को 'बिना जड़ की घास' कहा; जिला विकास आयुक्त (DDC) पद का सृजन।", "4 बार"],
          ["एल.एम. सिंघवी (1986)", "संवैधानिक दर्जा", "पंचायती राज को संवैधानिक मान्यता एवं सुरक्षा देने की मांग करने वाली प्रथम प्रमुख समिति।", "7 बार"],
        ],
        keyArticles: [
          { badge: "अनुच्छेद 243-A", title: "ग्राम सभा", detail: "ग्राम की मतदाता सूची में पंजीकृत सभी वयस्क व्यक्तियों का निकाय; राज्य विधानमंडल द्वारा प्रदत्त शक्तियां।", tag: "ग्राम स्तर" },
          { badge: "अनुच्छेद 243-D", title: "सीटों का आरक्षण", detail: "जनसंख्या के अनुपात में SC/ST आरक्षण; महिलाओं के लिए कम से कम 1/3 सीटें (अध्यक्ष पद सहित) आरक्षित।", tag: "उच्च ट्रैप" },
          { badge: "अनुच्छेद 243-I", title: "राज्य वित्त आयोग", detail: "राज्यपाल द्वारा प्रत्येक 5 वर्ष पर पंचायतों की वित्तीय स्थिति की समीक्षा हेतु गठन।", tag: "प्रत्येक 5 वर्ष" },
          { badge: "अनुच्छेद 243-K", title: "राज्य निर्वाचन आयोग", detail: "पंचायत चुनावों का अधीक्षण व संचालन; आयुक्त की नियुक्ति राज्यपाल द्वारा, पदमुक्ति उच्च न्यायालय के न्यायाधीश की भांति।", tag: "संवैधानिक निकाय" },
        ],
        chronologyLock: {
          title: "कालक्रम मेमोरी लॉक (B → A → G → L → T)",
          chain: "बलवंत राय (1957) → अशोक मेहता (1977) → जी.वी.के. राव (1985) → एल.एम. सिंघवी (1986) → पी.के. थुंगन (1988)",
          rule: "कालक्रम प्रश्नों में सदैव ध्यान रखें कि एल.एम. सिंघवी (1986) पी.के. थुंगन (1988) से पहले आती है।",
        },
      },
    },
    {
      id: "cs-fiscal-frbm",
      topicId: "top-econ-fiscal",
      type: "COMPARISON_TABLE",
      titleEn: "Comparison Sheet: Budget Deficits, FRBM Targets & Finance Commission",
      titleHi: "तुलनात्मक शीट: बजट घाटे के प्रकार, एफआरबीएम लक्ष्य एवं वित्त आयोग",
      mins: 3,
      pyqs: 18,
      srcEn: "Union Budget Documents, Economic Survey & FRBM Act 2003",
      srcHi: "केंद्रीय बजट दस्तावेज, आर्थिक समीक्षा एवं एफआरबीएम अधिनियम 2003",
      contentEn: {
        summary: "Eliminates confusion across all 4 Union/State deficit formulas repeatedly tested in UPPCS & RO/ARO Economy sections.",
        matrixTitle: "Four Deficit Indicators Master Formula Table",
        matrixHeaders: ["Deficit Type", "Exact Formula", "Economic Meaning / Commission Trap", "UPPSC Priority"],
        matrixRows: [
          ["Revenue Deficit (RD)", "Revenue Expenditure − Revenue Receipts", "Shows government's dissaving on day-to-day consumption without creating assets.", "High"],
          ["Effective Revenue Deficit", "Revenue Deficit − Grants for Creation of Capital Assets", "Introduced in 2011–12 (Rangarajan Committee); isolates pure consumption deficit.", "Asked 5x"],
          ["Fiscal Deficit (FD)", "Total Expenditure − (Revenue Receipts + Non-Debt Capital Receipts)", "Equals total market borrowing requirement of the government in a fiscal year.", "Asked 8x"],
          ["Primary Deficit (PD)", "Fiscal Deficit − Interest Payments", "Zero Primary Deficit means the government borrows ONLY to pay past interest.", "Asked 6x"],
        ],
        keyArticles: [
          { badge: "FRBM Act 2003", title: "N.K. Singh Review Panel", detail: "Recommended Debt-to-GDP anchor of 60% combined (40% Centre + 20% States) with escape clause up to 0.5%.", tag: "Statutory" },
          { badge: "Article 280", title: "Finance Commission", detail: "Quasi-judicial body constituted every 5th year by the President; recommends vertical & horizontal tax devolution.", tag: "Constitutional" },
        ],
        chronologyLock: {
          title: "DEFICIT MAGNITUDE ORDER (Typical Union Budget)",
          chain: "Fiscal Deficit > Revenue Deficit > Effective Revenue Deficit > Primary Deficit",
          rule: "Remember: Disinvestment proceeds are Non-Debt Capital Receipts—they REDUCE Fiscal Deficit!",
        },
      },
      contentHi: {
        summary: "यूपीपीसीएस एवं आरओ/एआरओ अर्थव्यवस्था खंड में बार-बार पूछे जाने वाले चारों बजट घाटों का सटीक सूत्र एवं अंतर।",
        matrixTitle: "चार प्रमुख बजट घाटे — मास्टर सूत्र तालिका",
        matrixHeaders: ["घाटे का प्रकार", "सटीक सूत्र", "आर्थिक अर्थ / परीक्षक ट्रैप", "प्राथमिकता"],
        matrixRows: [
          ["राजस्व घाटा (RD)", "राजस्व व्यय − राजस्व प्राप्तियां", "सरकार के दैनिक उपभोग व्यय और आय का अंतर (कोई परिसंपत्ति निर्माण नहीं)।", "उच्च"],
          ["प्रभावी राजस्व घाटा", "राजस्व घाटा − पूंजीगत परिसंपत्ति सृजन हेतु अनुदान", "2011–12 में प्रारंभ (रंगराजन समिति); शुद्ध उपभोग घाटे को दर्शाता है।", "5 बार"],
          ["राजकोषीय घाटा (FD)", "कुल व्यय − (राजस्व प्राप्तियां + गैर-ऋण पूंजीगत प्राप्तियां)", "सरकार की कुल बाजार उधारी आवश्यकता के बराबर।", "8 बार"],
          ["प्राथमिक घाटा (PD)", "राजकोषीय घाटा − ब्याज भुगतान", "शून्य प्राथमिक घाटे का अर्थ है कि उधारी केवल पुराने ब्याज चुकाने हेतु ली जा रही है।", "6 बार"],
        ],
        keyArticles: [
          { badge: "एफआरबीएम 2003", title: "एन.के. सिंह समिति", detail: "संयुक्त ऋण-जीडीपी अनुपात 60% (केंद्र 40% + राज्य 20%) एवं 0.5% एस्केप क्लॉज की सिफारिश।", tag: "वैधानिक" },
          { badge: "अनुच्छेद 280", title: "केंद्रीय वित्त आयोग", detail: "राष्ट्रपति द्वारा प्रत्येक 5 वर्ष पर गठित अर्ध-न्यायिक निकाय; केंद्र-राज्य कर बंटवारे की अनुशंसा।", tag: "संवैधानिक" },
        ],
        chronologyLock: {
          title: "सामान्य बजट में घाटे का आकार क्रम",
          chain: "राजकोषीय घाटा > राजस्व घाटा > प्रभावी राजस्व घाटा > प्राथमिक घाटा",
          rule: "विनिवेश (Disinvestment) गैर-ऋण पूंजीगत प्राप्ति है—यह राजकोषीय घाटे को कम करता है!",
        },
      },
    },
    {
      id: "cs-up-ramsar",
      topicId: "top-up-special-gk",
      type: "CHEAT_SHEET",
      titleEn: "UP Special Rapid Sheet: All 10 Ramsar Wetlands & District Mapping",
      titleHi: "उ.प्र. विशेष रैपिड शीट: सभी 10 रामसर आर्द्रभूमि स्थल एवं जिले",
      mins: 2,
      pyqs: 15,
      srcEn: "UP Forest & Wildlife Department + Ramsar Convention Secretariat",
      srcHi: "उ.प्र. वन एवं वन्यजीव विभाग + रामसर सचिवालय",
      contentEn: {
        summary: "Uttar Pradesh has the second-highest Ramsar sites in India (10 sites). Match-the-following questions appear almost every year across PCS & RO/ARO.",
        matrixTitle: "Complete UP Ramsar Sites District Matrix",
        matrixHeaders: ["Ramsar Wetland Site", "District in UP", "Year / Key Highlight", "Exam Trap"],
        matrixRows: [
          ["Upper Ganga River (Brijghat to Narora)", "Bulandshahr stretch", "2005 — First Ramsar site of Uttar Pradesh; Gangetic Dolphin habitat.", "Oldest in UP"],
          ["Nawabganj (Shaheed Chandra Shekhar Azad)", "Unnao", "2019 — Renamed after Chandra Shekhar Azad; Lucknow-Kanpur highway.", "Unnao"],
          ["Saman / Samaspur / Sandi", "Mainpuri / Raebareli / Hardoi", "2019 — Classic 'S-3' trio confused in List-I/List-II matching!", "High Trap"],
          ["Parvati Arga / Sarsai Nawar / Sur Sarovar", "Gonda / Etawah / Agra", "Sur Sarovar = Keetham Lake (Agra); Sarsai Nawar = Sarus Crane hub.", "Asked 4x"],
          ["Haiderpur & Bakhira Sanctuaries", "Muzaffarnagar-Bijnor / Sant Kabir Nagar", "2021–2022 — Latest additions bringing UP's total to 10 Ramsar sites.", "Asked in 2023-24"],
        ],
        keyArticles: [
          { badge: "2 February", title: "World Wetlands Day", detail: "Marks adoption of the Ramsar Convention in Iran on 2 Feb 1971.", tag: "Annual PYQ" },
          { badge: "Montreux Record", title: "Threatened Wetlands Register", detail: "In India, ONLY Keoladeo National Park (Rajasthan) and Loktak Lake (Manipur) are currently in Montreux Record (Chilika was removed).", tag: "Classic Trap" },
        ],
      },
      contentHi: {
        summary: "उत्तर प्रदेश में कुल 10 रामसर आर्द्रभूमि स्थल हैं—सूची सुमेलन में प्रतिवर्ष 1–2 प्रश्न निश्चित रूप से पूछे जाते हैं।",
        matrixTitle: "उत्तर प्रदेश के प्रमुख रामसर स्थल एवं जिले",
        matrixHeaders: ["रामसर आर्द्रभूमि स्थल", "संबंधित जिला", "वर्ष / प्रमुख विशेषता", "परीक्षक ट्रैप"],
        matrixRows: [
          ["ऊपरी गंगा नदी (ब्रजघाट से नरोरा)", "बुलंदशहर क्षेत्र", "2005 — उत्तर प्रदेश का प्रथम रामसर स्थल; गांगेय डॉल्फिन आवास।", "प्रथम स्थल"],
          ["नवाबगंज (शहीद चंद्रशेखर आजाद)", "उन्नाव", "2019 — लखनऊ-कानपुर राजमार्ग पर स्थित प्रमुख पक्षी विहार।", "उन्नाव"],
          ["समन / समसपुर / सांडी", "मैनपुरी / रायबरेली / हरदोई", "2019 — 'स' अक्षर वाले इन तीनों स्थलों के जिलों में सर्वाधिक भ्रम होता है!", "उच्च ट्रैप"],
          ["पार्वती अरगा / सरसई नावर / सूर सरोवर", "गोंडा / इटावा / आगरा", "सूर सरोवर को 'कीथम झील' (आगरा) भी कहा जाता है।", "4 बार"],
          ["हैदरपुर एवं बखीरा अभयारण्य", "मुजफ्फरनगर-बिजनौर / संत कबीर नगर", "2021–2022 — नवीनतम शामिल स्थल (कुल संख्या 10)।", "2023-24 PYQ"],
        ],
        keyArticles: [
          { badge: "2 फरवरी", title: "विश्व आर्द्रभूमि दिवस", detail: "2 फरवरी 1971 को ईरान के रामसर शहर में संधि पर हस्ताक्षर हुए थे।", tag: "वार्षिक प्रश्न" },
          { badge: "मॉन्ट्रेक्स रिकॉर्ड", title: "संकटग्रस्त आर्द्रभूमि पंजी", detail: "भारत के केवल केवलादेव (राजस्थान) और लोकटक झील (मणिपुर) इसमें शामिल हैं (चिल्का को हटाया जा चुका है)।", tag: "महत्वपूर्ण ट्रैप" },
        ],
      },
    },
  ];

  for (const a of artifacts) {
    await sql`
      INSERT INTO learning_artifacts (
        id, topic_id, artifact_type, title_en, title_hi, est_read_mins,
        pyq_coverage_count, canonical_source_en, canonical_source_hi,
        content_en, content_hi
      ) VALUES (
        ${a.id}, ${a.topicId}, ${a.type}, ${a.titleEn}, ${a.titleHi}, ${a.mins},
        ${a.pyqs}, ${a.srcEn}, ${a.srcHi},
        ${JSON.stringify(a.contentEn)}::jsonb, ${JSON.stringify(a.contentHi)}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        content_en = EXCLUDED.content_en,
        content_hi = EXCLUDED.content_hi
    `;
  }

  const starterFlashcards = [
    {
      id: "fc-art-243i",
      topicId: "top-polity-panchayat",
      qId: "q-flagship-ashok-mehta",
      deck: "ARTICLES",
      frontEn: "Under which Constitutional Article is the State Finance Commission constituted every 5 years to review the financial position of Panchayats, and who appoints it?",
      frontHi: "पंचायतों की वित्तीय स्थिति की समीक्षा करने के लिए प्रत्येक 5 वर्ष पर किस संवैधानिक अनुच्छेद के अंतर्गत 'राज्य वित्त आयोग' का गठन किया जाता है, और इसकी नियुक्ति कौन करता है?",
      backEn: "Article 243-I (for Panchayats) and Article 243-Y (for Municipalities) — Appointed by the Governor of the State.",
      backHi: "अनुच्छेद 243-I (पंचायतों हेतु) एवं अनुच्छेद 243-Y (नगरपालिकाओं हेतु) — राज्य के राज्यपाल द्वारा नियुक्त।",
      trapEn: "Aspirants confuse Art 243-I (Finance Commission) with Art 243-K (State Election Commission). Also note: the State Legislature (by law) determines its composition & qualifications.",
      trapHi: "अभ्यर्थी अनुच्छेद 243-I (वित्त आयोग) को अनुच्छेद 243-K (राज्य निर्वाचन आयोग) से भ्रमित कर देते हैं। इसकी संरचना का निर्धारण राज्य विधानमंडल विधि द्वारा करता है।",
      mnemEn: "I = Income (Art 243-I governs Panchayat Income/Finance) • K = Kingmaker/Elections (Art 243-K governs State Election Commission).",
      mnemHi: "I = Income/आय (अनुच्छेद 243-I = राज्य वित्त आयोग) • K = चुनाव/Kingmaker (अनुच्छेद 243-K = राज्य निर्वाचन आयोग)।",
      askedEn: "Asked in UPPCS 2018, 2021, 2024",
      askedHi: "यूपीपीसीएस 2018, 2021, 2024 में पूछा गया",
    },
    {
      id: "fc-ashok-mehta",
      topicId: "top-polity-panchayat",
      qId: "q-flagship-ashok-mehta",
      deck: "COMMITTEES",
      frontEn: "Which Panchayati Raj committee recommended a 2-Tier structure (Zila Parishad + Mandal Panchayat) AND open participation of political parties at all election levels?",
      frontHi: "किस पंचायती राज समिति ने द्वि-स्तरीय संरचना (जिला परिषद + मंडल पंचायत) और सभी चुनाव स्तरों पर राजनीतिक दलों की खुली भागीदारी की सिफारिश की थी?",
      backEn: "Ashok Mehta Committee (appointed Dec 1977, report 1978 — 132 recommendations).",
      backHi: "अशोक मेहता समिति (गठन दिसंबर 1977, रिपोर्ट 1978 — कुल 132 सिफारिशें)।",
      trapEn: "UPPSC statements frequently flip 'open participation' into 'prohibited political parties' to trap candidates thinking of Gandhian party-less panchayats.",
      trapHi: "आयोग अक्सर 'राजनीतिक दलों की खुली भागीदारी' को बदलकर 'दलों पर प्रतिबंध' लिख देता है—इस ट्रैप से सावधान रहें!",
      mnemEn: "Ashok (2 words: Ashok Mehta) = 2-Tier + Open Party Contest.",
      mnemHi: "अशोक मेहता (2 शब्द) = द्वि-स्तरीय (2-Tier) प्रणाली + खुली दलीय भागीदारी।",
      askedEn: "Asked in UPPCS 2025, ACF 2021, RO/ARO 2018",
      askedHi: "यूपीपीसीएस 2025, एसीएफ 2021, आरओ/एआरओ 2018",
    },
    {
      id: "fc-effective-rd",
      topicId: "top-econ-fiscal",
      qId: "q-cb-econ-frbm",
      deck: "ECONOMY",
      frontEn: "What is the exact formula for Effective Revenue Deficit (ERD), and which committee introduced it?",
      frontHi: "'प्रभावी राजस्व घाटा' (Effective Revenue Deficit) का सटीक सूत्र क्या है और इसे किस समिति की सिफारिश पर लागू किया गया?",
      backEn: "ERD = Revenue Deficit − Grants given to States/UTs for creation of Capital Assets (C. Rangarajan Committee, Union Budget 2011–12).",
      backHi: "प्रभावी राजस्व घाटा = राजस्व घाटा − पूंजीगत परिसंपत्तियों के सृजन हेतु अनुदान (सी. रंगराजन समिति, बजट 2011–12)।",
      trapEn: "Grants to states are booked as Revenue Expenditure in Union accounts even when states build roads/schools with them—ERD corrects that accounting distortion.",
      trapHi: "राज्यों को दिए गए अनुदान केंद्र के खाते में राजस्व व्यय गिने जाते हैं, भले ही उनसे पूंजीगत निर्माण हो—ERD इसी विसंगति को सुधारता है।",
      mnemEn: "Effective RD = Strip out Capital-building Grants from Revenue Deficit.",
      mnemHi: "प्रभावी राजस्व घाटा = राजस्व घाटे में से पूंजीगत अनुदान घटाएं।",
      askedEn: "Asked in UPPCS 2019, 2022, RO/ARO 2021",
      askedHi: "यूपीपीसीएस 2019, 2022 एवं आरओ/एआरओ में पूछा गया",
    },
    {
      id: "fc-pesa-mfp",
      topicId: "top-polity-pesa",
      qId: "q-ncert-pesa-1996",
      deck: "ARTICLES",
      frontEn: "Which committee led to the enactment of the PESA Act 1996, and which Schedule areas does it cover?",
      frontHi: "पेसा अधिनियम (PESA Act, 1996) किस समिति की सिफारिश पर बना और यह संविधान की किस अनुसूची के क्षेत्रों पर लागू होता है?",
      backEn: "Dileep Singh Bhuria Committee (1995) — Applies to Fifth Schedule areas across 10 States (NOT Sixth Schedule autonomous districts).",
      backHi: "दिलीप सिंह भूरिया समिति (1995) — 10 राज्यों के 'पांचवीं अनुसूची' क्षेत्रों पर लागू (छठी अनुसूची पर नहीं)।",
      trapEn: "Examiners swap 'Fifth Schedule (10 states)' with 'Sixth Schedule (Assam, Meghalaya, Tripura, Mizoram)'.",
      trapHi: "परीक्षक 'पांचवीं अनुसूची' के स्थान पर 'छठी अनुसूची (असम, मेघालय, त्रिपुरा, मिजोरम)' लिखकर भ्रमित करते हैं।",
      mnemEn: "PESA = Panch-vi (5th) Schedule • Bhuria Committee • Gram Sabha owns Minor Forest Produce.",
      mnemHi: "पेसा (PESA) = पांचवीं अनुसूची • भूरिया समिति • लघु वनोपज पर ग्राम सभा का अधिकार।",
      askedEn: "Asked in UPPCS 2020, 2023",
      askedHi: "यूपीपीसीएस 2020 एवं 2023 में पूछा गया",
    },
    {
      id: "fc-up-ramsar-s3",
      topicId: "top-up-special-gk",
      qId: "q-cb-up-ramsar",
      deck: "ENVIRONMENT",
      frontEn: "Distinguish the districts of UP's four 'S'-named Ramsar wetlands: Saman, Samaspur, Sandi, and Sarsai Nawar.",
      frontHi: "उत्तर प्रदेश के 'स' अक्षर से शुरू होने वाले चारों रामसर स्थलों—समन, समसपुर, सांडी और सरसई नावर—के जिले बताइए।",
      backEn: "Saman = Mainpuri • Samaspur = Raebareli • Sandi = Hardoi • Sarsai Nawar = Etawah.",
      backHi: "समन = मैनपुरी • समसपुर = रायबरेली • सांडी = हरदोई • सरसई नावर = इटावा।",
      trapEn: "Sarsai Nawar (Etawah) and Sandi (Hardoi) are swapped in 80% of UPPSC Match-the-Following questions.",
      trapHi: "सरसई नावर (इटावा) और सांडी (हरदोई) को आयोग सूची सुमेलन में सबसे अधिक आपस में बदलता है।",
      mnemEn: "SaMAN = MANpuri • SaNDI = HarDOI • SaMASpur = RAEbareli • SarSAI = ETAwah.",
      mnemHi: "समन = मैनपुरी • सांडी = हरदोई • समसपुर = रायबरेली • सरसई = इटावा।",
      askedEn: "Asked in UPPCS 2021, 2022, RO/ARO 2023",
      askedHi: "यूपीपीसीएस 2021, 2022 एवं आरओ/एआरओ में पूछा गया",
    },
    {
      id: "fc-kvk-1974",
      topicId: "top-sci-bio-agri",
      qId: "q-flagship-kvk-115",
      deck: "SCIENCE",
      frontEn: "Where and when was India's first Krishi Vigyan Kendra (KVK) established, and on which committee's recommendation?",
      frontHi: "भारत का पहला कृषि विज्ञान केंद्र (KVK) कब, कहां और किस समिति की सिफारिश पर स्थापित किया गया था?",
      backEn: "Puducherry (1974) under Tamil Nadu Agricultural University (TNAU), recommended by the Mohan Singh Mehta Committee (1973).",
      backHi: "पुडुचेरी (1974), तमिलनाडु कृषि विश्वविद्यालय (TNAU) के अधीन — मोहन सिंह मेहता समिति (1973) की सिफारिश पर।",
      trapEn: "Candidates often guess Pantnagar (first Agricultural University, 1960) instead of Puducherry (first KVK, 1974).",
      trapHi: "अभ्यर्थी अक्सर पंतनगर (प्रथम कृषि विश्वविद्यालय, 1960) चुन लेते हैं, जबकि प्रथम KVK पुडुचेरी (1974) में बना था।",
      mnemEn: "1960 Pantnagar = 1st Agri University • 1974 Puducherry = 1st KVK (Mohan Singh Mehta).",
      mnemHi: "1960 पंतनगर = प्रथम कृषि वि.वि. • 1974 पुडुचेरी = प्रथम कृषि विज्ञान केंद्र।",
      askedEn: "Asked in UPPCS Prelims",
      askedHi: "यूपीपीसीएस प्रारंभिक परीक्षा में पूछा गया",
    },
  ];

  for (const fc of starterFlashcards) {
    await sql`
      INSERT INTO flashcards (
        id, topic_id, source_question_id, deck_category,
        front_en, front_hi, back_en, back_hi,
        trap_warning_en, trap_warning_hi, mnemonic_en, mnemonic_hi,
        asked_in_label_en, asked_in_label_hi
      ) VALUES (
        ${fc.id}, ${fc.topicId}, ${fc.qId}, ${fc.deck},
        ${fc.frontEn}, ${fc.frontHi}, ${fc.backEn}, ${fc.backHi},
        ${fc.trapEn}, ${fc.trapHi}, ${fc.mnemEn}, ${fc.mnemHi},
        ${fc.askedEn}, ${fc.askedHi}
      )
      ON CONFLICT (id) DO UPDATE SET
        front_en = EXCLUDED.front_en,
        front_hi = EXCLUDED.front_hi,
        back_en = EXCLUDED.back_en,
        back_hi = EXCLUDED.back_hi
    `;
  }

  console.log("[seed] 6/6 Seeding Razorpay Subscription Plans...");
  await sql`
    INSERT INTO subscription_plans (
      id, code, name_en, name_hi, badge_en, badge_hi,
      amount_paise, currency, validity_days, features_en, features_hi
    ) VALUES
      (
        'plan-sankalp-pro-annual',
        'SANKALP_PRO_ANNUAL',
        'Sankalp All-UPPSC Annual Pro Pass (2026–27)',
        'संकल्प संपूर्ण यूपीपीएससी वार्षिक प्रो पास (2026–27)',
        'Most Popular • Covers PCS + RO/ARO + ACF + BEO',
        'सर्वाधिक लोकप्रिय • पीसीएस + आरओ/एआरओ + एसीएफ कवर',
        49900,
        'INR',
        365,
        ${JSON.stringify([
          "Unlimited Full-Length Timed Papers across UPPCS, RO/ARO, ACF/RFO & BEO",
          "6,800+ Verified Official PYQs + Concept Builder & NCERT Drills (Pure EN or Pure HI)",
          "All High-Yield Topic Cheat Sheets, Comparison Matrices & FSRS Mistake Flashcards",
          "Cross-Exam Readiness Portfolio & 50-50 Guesswork Net-Gain Diagnostics",
        ])}::jsonb,
        ${JSON.stringify([
          "यूपीपीसीएस, आरओ/एआरओ, एसीएफ एवं बीईओ की असीमित पूर्ण-लंबाई टेस्ट सीरीज",
          "6,800+ प्रमाणित विगत वर्ष प्रश्न + कॉन्सेप्ट बिल्डर व एनसीईआरटी अभ्यास (शुद्ध हिन्दी या अंग्रेजी)",
          "सभी हाई-यील्ड चीट शीट्स, तुलनात्मक तालिकाएं एवं FSRS रिवीजन फ्लैशकार्ड्स",
          "क्रॉस-एग्जाम रेडीनेस पोर्टफोलियो एवं 50-50 तुक्का दक्षता विश्लेषण",
        ])}::jsonb
      ),
      (
        'plan-uppcs-prelims-booster',
        'UPPCS_PRELIMS_90D',
        'UPPCS Prelims 90-Day Crash Pass',
        'यूपीपीसीएस प्रारंभिक 90-दिवसीय क्रैश पास',
        'Targeted Cycle Booster',
        'लक्षित प्रारंभिक बूस्टर',
        24900,
        'INR',
        90,
        ${JSON.stringify([
          "Full UPPCS Prelims GS-I Question Bank & Simulated Mocks",
          "Daily 15-Min Adaptive Smart Drills & Weak-Topic Cheat Sheets",
          "Unlimited FSRS Mistake Flashcard Reviews",
        ])}::jsonb,
        ${JSON.stringify([
          "संपूर्ण यूपीपीसीएस प्रा. सामान्य अध्ययन प्रश्न बैंक एवं मॉक टेस्ट",
          "दैनिक 15-मिनट स्मार्ट ड्रिल एवं कमजोर विषय चीट शीट्स",
          "असीमित FSRS गलती सुधार फ्लैशकार्ड अभ्यास",
        ])}::jsonb
      )
    ON CONFLICT (id) DO UPDATE SET
      amount_paise = EXCLUDED.amount_paise,
      features_en = EXCLUDED.features_en,
      features_hi = EXCLUDED.features_hi
  `;

  const counts = await sql`
    SELECT
      (SELECT COUNT(*) FROM exams) AS exams,
      (SELECT COUNT(*) FROM syllabus_topics) AS topics,
      (SELECT COUNT(*) FROM exam_papers) AS papers,
      (SELECT COUNT(*) FROM questions) AS questions,
      (SELECT COUNT(*) FROM learning_artifacts) AS artifacts,
      (SELECT COUNT(*) FROM flashcards) AS flashcards,
      (SELECT COUNT(*) FROM subscription_plans) AS plans
  `;
  console.log("[seed] Complete! Live Neon row counts:", counts[0]);
}

main().catch((err) => {
  console.error("[seed] Fatal error:", err);
  process.exit(1);
});
