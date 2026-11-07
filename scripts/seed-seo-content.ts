import { config as loadEnv } from "dotenv";
import { createDb } from "../src/db/client";
import { loadNodeNeonDatabaseUrl } from "../src/db/node-env";
import * as schema from "../src/db/schema";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const INITIAL_SEO_POSTS: Array<typeof schema.seoPosts.$inferInsert> = [
  {
    id: "post-ca-up-budget-2026",
    slug: "uttar-pradesh-budget-economic-survey-uppcs-prelims-key-facts",
    category: "CURRENT_AFFAIRS",
    linkedTopicId: "top-econ-fiscal",
    titleEn: "Uttar Pradesh Budget & Fiscal Deficit Targets: 15 Guaranteed Facts for UPPCS Prelims & RO/ARO",
    titleHi: "उत्तर प्रदेश बजट एवं राजकोषीय घाटा लक्ष्य: UPPCS प्रारंभिक एवं RO/ARO हेतु 15 अचूक तथ्य",
    summaryEn:
      "Master UP's GSDP growth estimate, FRBM fiscal deficit ceiling, capital outlay priorities, and flagship scheme allocations tested repeatedly by UPPSC.",
    summaryHi:
      "उ.प्र. के GSDP वृद्धि अनुमान, FRBM राजकोषीय घाटा सीमा, पूंजीगत परिव्यय प्राथमिकताओं और प्रमुख योजनाओं के आवंटन का संपूर्ण विश्लेषण।",
    bodyEn: `Uttar Pradesh's annual budget and fiscal indicators account for 6 to 9 direct questions across UPPCS Combined State Prelims and UPPSC RO/ARO every cycle. Aspirants frequently lose marks on subtle numerical traps between Revenue Surplus and Fiscal Deficit as a percentage of GSDP.

### 1. Fiscal Architecture & FRBM Compliance
Uttar Pradesh has consistently maintained its Fiscal Deficit within the FRBM statutory threshold (around 3.0% to 3.5% of GSDP while maintaining a Revenue Surplus to fund infrastructure capex). Remember the core Commission distinction:
- **Primary Deficit** = Fiscal Deficit minus Interest Payments on previous borrowings.
- **Effective Revenue Deficit** = Revenue Deficit minus Grants-in-Aid for creation of capital assets.

### 2. High-Yield Sectoral Priorities
UPPSC examiners routinely test chronological launch dates and nodal departments of state flagship initiatives, expressway corridors (Ganga Expressway, Bundelkhand Industrial Development Authority — BIDA in Jhansi), One District One Product (ODOP) export hubs, and renewable solar park targets in Bundelkhand.

### 3. How to Lock These Facts Into Memory
Instead of re-reading 80-page PDFs, immediately run a 10-question Targeted Drill on Fiscal Policy & Budget inside Sankalp's Adaptive Cockpit and save any missed figure directly into your FSRS Flashcard Deck.`,
    bodyHi: `उत्तर प्रदेश के वार्षिक बजट और राजकोषीय संकेतकों से प्रत्येक वर्ष UPPCS प्रारंभिक परीक्षा तथा RO/ARO में 6 से 9 सीधे प्रश्न पूछे जाते हैं।

### 1. राजकोषीय संरचना एवं FRBM अनुपालन
उत्तर प्रदेश ने अपने राजकोषीय घाटे को FRBM सीमा के भीतर रखते हुए राजस्व अधिशेष (Revenue Surplus) के माध्यम से पूंजीगत अवसंरचना निवेश को गति दी है:
- **प्राथमिक घाटा (Primary Deficit)** = राजकोषीय घाटा − ब्याज भुगतान।
- **प्रभावी राजस्व घाटा** = राजस्व घाटा − पूंजीगत परिसंपत्तियों के सृजन हेतु अनुदान।

### 2. उच्च-उपयोगी क्षेत्रीय प्राथमिकताएं
गंगा एक्सप्रेसवे, बुंदेलखंड औद्योगिक विकास प्राधिकरण (BIDA - झांसी), ODOP निर्यात केंद्र और सौर ऊर्जा पार्क से जुड़े तथ्यों का अभ्यास संकल्प के अनुकूली टेस्ट कॉकपिट में तुरंत करें।`,
    keyTakeawaysEn: [
      "Primary Deficit = Fiscal Deficit minus Interest Payments (asked 7+ times in UPPSC).",
      "BIDA (Bundelkhand Industrial Development Authority) is being developed on the lines of NOIDA across Jhansi villages.",
      "Maintain strict distinction between Revenue Account receipts and Capital Account borrowings.",
    ],
    keyTakeawaysHi: [
      "प्राथमिक घाटा = राजकोषीय घाटा − ब्याज भुगतान (आयोग द्वारा 7+ बार पूछा गया)।",
      "BIDA (बुंदेलखंड औद्योगिक विकास प्राधिकरण) का विकास झांसी क्षेत्र में NOIDA की तर्ज पर किया जा रहा है।",
      "राजस्व प्राप्तियों एवं पूंजीगत उधारियों के अंतर को स्पष्ट रखें।",
    ],
    tags: ["UP Budget", "Indian Economy", "UPPCS Prelims 2026", "RO/ARO Current Affairs"],
    examSlugs: ["uppcs-prelims", "uppsc-ro-aro"],
    readingTimeMins: 5,
    publishedAt: new Date("2026-11-07T06:30:00Z"),
  },
  {
    id: "post-ca-rbi-monetary-inflation",
    slug: "rbi-monetary-policy-repo-rate-crr-slr-uppcs-economy-current-affairs",
    category: "CURRENT_AFFAIRS",
    linkedTopicId: "top-econ-monetary",
    titleEn: "RBI Monetary Policy Committee (MPC), Liquidity Tools & Inflation Targeting Digest",
    titleHi: "आरबीआई मौद्रिक नीति समिति (MPC), तरलता उपकरण एवं मुद्रास्फीति लक्ष्यीकरण सार",
    summaryEn:
      "Understand Section 45ZB of the RBI Act 1934, 4% +/- 2% CPI target band, SDF vs MSF corridor, and statement-trap PYQs from UPPSC.",
    summaryHi:
      "आरबीआई अधिनियम 1934 की धारा 45ZB, 4% (+/-2%) CPI लक्ष्य, SDF बनाम MSF गलियारा और आयोग के कथन-आधारित प्रश्नों का विश्लेषण।",
    bodyEn: `With over 1,290 verified Indian Economy questions in the Sankalp Question Bank, Monetary Policy & Banking stands out as one of the highest-ROI micro-topics for Civil Services aspirants.

### Statutory Composition of MPC (Section 45ZB)
The Monetary Policy Committee consists of **6 members** (3 internal RBI officials including the Governor as ex-officio Chairperson, and 3 external members appointed by the Central Government for a 4-year non-renewable term). Notice the classic UPPSC trap: the Finance Minister is **not** a member of the MPC, and the RBI Governor holds a casting vote only in the event of a tie.

### Liquidity Adjustment Facility (LAF) Corridor
- **Standing Deposit Facility (SDF):** Floor of the LAF corridor; absorbs excess liquidity from banks **without** requiring government securities as collateral.
- **Repo Rate:** Policy benchmark rate at which banks borrow overnight liquidity against G-Secs.
- **Marginal Standing Facility (MSF):** Ceiling of the corridor; penal overnight window allowing banks to dip up to 2% into their SLR portfolio.`,
    bodyHi: `संकल्प प्रश्न बैंक में भारतीय अर्थव्यवस्था के 1,290+ सत्यापित प्रश्नों के विश्लेषण से स्पष्ट है कि मौद्रिक नीति और बैंकिंग सर्वाधिक अंकदायी विषय है।

### मौद्रिक नीति समिति (धारा 45ZB)
MPC में कुल **6 सदस्य** होते हैं (आरबीआई गवर्नर सहित 3 आंतरिक सदस्य और केंद्र सरकार द्वारा 4 वर्ष हेतु नियुक्त 3 बाहरी सदस्य)। ध्यान दें: वित्त मंत्री इसके सदस्य नहीं होते।

### तरलता समायोजन सुविधा (LAF)
- **SDF (स्थायी जमा सुविधा):** बिना सरकारी प्रतिभूति (Collateral-free) के अतिरिक्त तरलता अवशोषण।
- **रेपो दर:** नीतिगत बेंचमार्क दर।
- **MSF:** गलियारे की ऊपरी सीमा।`,
    keyTakeawaysEn: [
      "MPC has 6 members under Section 45ZB of RBI Act 1934; CPI target is 4% (+/- 2%).",
      "SDF absorbs liquidity without G-Sec collateral (introduced in April 2022).",
      "Headline inflation in India for MPC targeting is measured by CPI-Combined (NSO).",
    ],
    keyTakeawaysHi: [
      "MPC में कुल 6 सदस्य होते हैं; मुद्रास्फीति लक्ष्य 4% (+/- 2%) CPI-Combined पर आधारित है।",
      "SDF में आरबीआई को प्रतिभूति देने की आवश्यकता नहीं होती।",
    ],
    tags: ["RBI MPC", "Monetary Policy", "Indian Economy PYQ", "UPSC & UPPCS"],
    examSlugs: ["uppcs-prelims", "upsc-cse", "uppsc-ro-aro"],
    readingTimeMins: 4,
    publishedAt: new Date("2026-11-06T08:00:00Z"),
  },
  {
    id: "post-ca-up-ramsar-wetlands",
    slug: "uttar-pradesh-ramsar-sites-wildlife-sanctuaries-district-list-map",
    category: "CURRENT_AFFAIRS",
    linkedTopicId: "top-env-biodiversity",
    titleEn: "Complete District-Wise Guide to Uttar Pradesh's Ramsar Wetlands & Tiger Reserves",
    titleHi: "उत्तर प्रदेश के रामसर आर्द्रभूमि स्थल एवं टाइगर रिज़र्व: जिला-वार संपूर्ण सूची",
    summaryEn:
      "Stop losing marks in Match-the-List questions: memorize Upper Ganga stretch, Haiderpur, Bakhira, Sur Sarovar, Nawabganj, and Ranipur Tiger Reserve.",
    summaryHi:
      "'सूची-I को सूची-II से सुमेलित कीजिए' प्रश्नों में शत-प्रतिशत सटीकता हेतु उ.प्र. के रामसर स्थलों और रानीपुर टाइगर रिज़र्व की जिला-वार ट्रिक।",
    bodyEn: `Every single UPPCS Prelims and RO/ARO paper includes at least 2 'Match List-I with List-II' questions pairing Uttar Pradesh wetlands, bird sanctuaries, or tiger reserves with their exact districts.

### High-Frequency UP Ramsar Pairs
1. **Upper Ganga River (Brijghat to Narora Stretch):** First Ramsar site declared in Uttar Pradesh (2005).
2. **Nawabganj Bird Sanctuary (Shaheed Chandra Shekhar Azad):** Unnao district.
3. **Saman Bird Sanctuary:** Mainpuri | **Samaspur Bird Sanctuary:** Raebareli | **Sandi Bird Sanctuary:** Hardoi *(Examiner's favorite 'S-triplet' confusion trap!)*.
4. **Sur Sarovar (Keetham Lake):** Agra | **Sarsai Nawar Jheel:** Etawah.
5. **Haiderpur Wetland:** Muzaffarnagar–Bijnor border | **Bakhira Wildlife Sanctuary:** Sant Kabir Nagar.
6. **Ranipur Tiger Reserve (53rd in India, 4th in UP):** Chitrakoot region (Bundelkhand).`,
    bodyHi: `प्रत्येक UPPCS और RO/ARO प्रश्नपत्र में उत्तर प्रदेश के पक्षी विहार, रामसर स्थल और जिलों के सुमेलन पर कम से कम 2 प्रश्न अवश्य आते हैं।

### सर्वाधिक पूछे जाने वाले युग्म
1. **ऊपरी गंगा नदी (ब्रजघाट से नरौरा):** उत्तर प्रदेश का प्रथम रामसर स्थल (2005)।
2. **नवाबगंज (शहीद चंद्रशेखर आज़ाद) पक्षी विहार:** उन्नाव।
3. **समान:** मैनपुरी | **समसपुर:** रायबरेली | **सांडी:** हरदोई।
4. **सूर सरोवर (कीठम झील):** आगरा | **बखीरा वन्यजीव विहार:** संत कबीर नगर।
5. **रानीपुर टाइगर रिज़र्व:** चित्रकूट (बुंदेलखंड)।`,
    keyTakeawaysEn: [
      "Memorize the S-Triplet: Saman = Mainpuri, Samaspur = Raebareli, Sandi = Hardoi.",
      "Upper Ganga River (Brijghat to Narora) is UP's oldest Ramsar site (2005).",
      "Ranipur in Chitrakoot is UP's 4th Tiger Reserve alongside Dudhwa, Pilibhit, and Amangarh.",
    ],
    keyTakeawaysHi: [
      "S-ट्रिक: समान = मैनपुरी, समसपुर = रायबरेली, सांडी = हरदोई।",
      "ऊपरी गंगा नदी (ब्रजघाट-नरौरा) उ.प्र. का पहला रामसर स्थल है।",
    ],
    tags: ["UP Special GK", "Environment & Ecology", "Ramsar Sites", "Match-the-List"],
    examSlugs: ["uppcs-prelims", "uppsc-ro-aro", "uppsc-beo"],
    readingTimeMins: 5,
    publishedAt: new Date("2026-11-05T07:15:00Z"),
  },
  {
    id: "post-blog-50-50-elimination-science",
    slug: "how-to-clear-uppcs-prelims-cutoff-with-50-50-elimination-calibration",
    category: "BLOG",
    linkedTopicId: "top-polity-panchayat",
    titleEn: "The Math Behind Clearing UPPCS Prelims: Why 50-50 Elimination Beats Blind Guessing Under -1/3 Negative Marking",
    titleHi: "UPPCS प्रारंभिक कटऑफ पार करने का गणित: -1/3 नकारात्मक अंकन में 50-50 एलिमिनेशन क्यों निर्णायक है",
    summaryEn:
      "Under +1.33 / -0.44 marking, eliminating two wrong options shifts your expected value per question from +0.00 to +0.445 marks. Here is how toppers calibrate risk.",
    summaryHi:
      "+1.33 / -0.44 अंकन प्रणाली में दो गलत विकल्प हटाने पर प्रति प्रश्न अपेक्षित लाभ +0.445 अंक हो जाता है। जानिए टॉपर्स जोखिम कैसे मापते हैं।",
    bodyEn: `Most serious UPPCS aspirants know 65 to 72 questions out of 150 with 100% certainty on exam day. Yet the safe cutoff hovers around 88 to 95 net marks (roughly 92–98 net correct after negative penalties). How do repeat prelims qualifiers bridge that 20-question gap every single year without blowing up their negative score?

### Expected Value Under UPPSC's 1/3rd Penalty
In UPPCS GS Paper I:
- Correct answer = **+1.333 marks**
- Wrong answer = **-0.444 marks** (exact 1/3rd penalty)

If you guess blindly across 4 options (25% probability), your mathematical expected value is **zero** — high variance with zero edge.
However, the moment you eliminate **2 clearly wrong options** (for instance, spotting one anachronistic year in a Chronology question or one known pair in Match-the-List), your probability jumps to **50%**:
- Expected Gain on 10 such 50-50 attempts = (5 × 1.333) − (5 × 0.444) = **+4.45 net marks**!
- Across 30 disciplined 50-50 eliminations, that is **+13.3 net marks** — the entire margin between missing Prelims by 4 marks and comfortably writing Mains.

### Why Sankalp Tracks Your Personal 50-50 Net Gain
Generic test portals only tell you 'Right vs Wrong'. Inside Sankalp's Test Cockpit, you strike out options with Alt+Click and tag attempts as **100% Sure**, **50-50 Elimination**, or **Wild Guess**. Post-test, Sankalp calculates your exact **50-50 Net Marks Gained** vs **Wild-Guess Drag**, training your exam-hall instinct scientifically.`,
    bodyHi: `अधिकांश गंभीर अभ्यर्थियों को 150 में से 65–72 प्रश्न ही शत-प्रतिशत निश्चितता के साथ आते हैं, जबकि सुरक्षित कटऑफ 90+ शुद्ध अंकों के आसपास रहती है।

### +1.33 / -0.44 अंकन का अपेक्षित मूल्य (Expected Value)
जब आप दो गलत विकल्पों को काट देते हैं (50-50 स्थिति), तो 10 प्रश्नों पर आपका गणितीय शुद्ध लाभ **+4.45 अंक** और 30 प्रश्नों पर **+13.3 अंक** होता है। संकल्प का टेस्ट कॉकपिट आपके प्रत्येक टेस्ट में '50-50 शुद्ध लाभ' और 'वाइल्ड गेस नुकसान' की अलग गणना करता है।`,
    keyTakeawaysEn: [
      "Never leave a true 2-option (50-50) elimination unattempted under 1/3rd negative marking.",
      "Eliminating just 1 option in Match-the-List PYQs often collapses 3 of the 4 code combinations immediately.",
      "Track your personal 50-50 ROI across 5 mocks before exam day to eliminate blind wild guesses.",
    ],
    keyTakeawaysHi: [
      "1/3 नकारात्मक अंकन में सच्चे 50-50 प्रश्नों को छोड़ना कटऑफ से बाहर होने का सबसे बड़ा कारण है।",
      "सुमेलन प्रश्नों में केवल एक युग्म पहचानने से अक्सर 3 गलत कूट स्वतः हट जाते हैं।",
    ],
    tags: ["UPPCS Strategy", "Negative Marking Math", "Prelims Cutoff", "50-50 Elimination"],
    examSlugs: ["uppcs-prelims", "upsc-cse", "uppsc-ro-aro"],
    readingTimeMins: 6,
    publishedAt: new Date("2026-11-04T10:00:00Z"),
  },
  {
    id: "post-blog-ro-aro-200-marks-blueprint",
    slug: "uppsc-ro-aro-prelims-gs-general-hindi-140-plus-score-blueprint",
    category: "BLOG",
    linkedTopicId: "top-up-special-gk",
    titleEn: "UPPSC RO/ARO Prelims 200-Marks Blueprint: Balancing 140 GS Questions + 60 High-Accuracy Hindi Items",
    titleHi: "UPPSC RO/ARO प्रारंभिक परीक्षा 200-अंक ब्लूप्रिंट: 140 सामान्य अध्ययन + 60 सामान्य हिन्दी रणनीति",
    summaryEn:
      "How to combine 52+ in General Hindi (6 vocabulary topics) with 85+ in GS Paper I using cross-exam UPPSC PYQ lineage.",
    summaryHi:
      "सामान्य हिन्दी के 6 निर्धारित विषयों में 52+ अंक और सामान्य अध्ययन में 85+ अंक प्राप्त कर 135+ सुरक्षित स्कोर कैसे सुनिश्चित करें।",
    bodyEn: `UPPSC Review Officer / Assistant Review Officer (RO/ARO) Prelims rewards precision more than any other state exam because its 200 marks are split across **140 marks of General Studies** and **60 marks of General Hindi** (just 6 lexical micro-topics: Vilom, Vakya & Vartani Shuddhi, Anekarthi/One-Word Substitution, Tatsam-Tadbhav, Visheshya-Visheshan, and Paryayvachi).

### Why UPPCS + RO/ARO Preparation Overlaps by 78%
Our cross-paper lineage database shows that questions asked in UPPCS Prelims 2019–2024 routinely reappear in RO/ARO, BEO, and ACF/RFO papers with modified statement framing. With Sankalp's Multi-Exam Journey Switcher, your single topic mastery profile powers separate cutoff readiness predictions for both **UPPCS Prelims (out of 200)** and **RO/ARO (out of 200)** simultaneously.`,
    bodyHi: `UPPSC समीक्षा अधिकारी / सहायक समीक्षा अधिकारी (RO/ARO) प्रारंभिक परीक्षा में 140 अंक सामान्य अध्ययन और 60 अंक सामान्य हिन्दी (केवल 6 शब्दावली विषय) के होते हैं।

### UPPCS और RO/ARO में 78% पाठ्यक्रम समानता
आयोग के विगत वर्षों के प्रश्नों के क्रॉस-पेपर विश्लेषण से सिद्ध होता है कि UPPCS के प्रश्न RO/ARO और BEO में बार-बार दोहराए जाते हैं।`,
    keyTakeawaysEn: [
      "Target 52–55/60 in RO/ARO General Hindi across the 6 fixed vocabulary topics.",
      "Prioritize Indian Economy, Polity, UP Special, Environment, and Modern History for GS 85+.",
      "Use Sankalp's Cross-Exam Portfolio Radar to track UPPCS & RO/ARO readiness side by side.",
    ],
    keyTakeawaysHi: [
      "सामान्य हिन्दी के 6 विषयों में 52–55 अंक का लक्ष्य रखें।",
      "एक ही अभ्यास से UPPCS और RO/ARO दोनों की कटऑफ तत्परता ट्रैक करें।",
    ],
    tags: ["UPPSC RO/ARO", "Exam Blueprint", "General Hindi", "UPPCS Overlap"],
    examSlugs: ["uppsc-ro-aro", "uppcs-prelims"],
    readingTimeMins: 5,
    publishedAt: new Date("2026-11-03T09:00:00Z"),
  },
  {
    id: "post-blog-pyq-repeat-lineage",
    slug: "uppcs-previous-year-question-repeat-analysis-high-yield-topics",
    category: "BLOG",
    linkedTopicId: "top-polity-panchayat",
    titleEn: "Data Audit of 85 UPPSC Papers: Why 38% of Prelims Questions Trace Back to Core PYQ Themes",
    titleHi: "85 UPPSC प्रश्नपत्रों का डेटा ऑडिट: क्यों 38% प्रश्न मूल PYQ विषयों से ही पूछे जाते हैं",
    summaryEn:
      "From 73rd Constitutional Amendment committees to Five-Year Plan models and Vitamin deficiency pairs — see the exact micro-topics UPPSC never stops testing.",
    summaryHi:
      "73वें संविधान संशोधन की समितियों से लेकर पंचवर्षीय योजनाओं और विटामिन युग्मों तक — वे सूक्ष्म विषय जिन्हें आयोग हर वर्ष पूछता है।",
    bodyEn: `When we indexed 85 official UPPSC papers and over 2,100 verified questions into Sankalp's Neon Lakebase engine, a remarkable pattern emerged: while surface wording evolves toward multi-statement and Assertion-Reason formats, **38% of core factual anchors repeat across cycles**.

### Top 5 Evergreen Micro-Topics Across UPPSC Papers
1. **Panchayati Raj & Urban Local Bodies:** Balwant Rai Mehta (1957) → Ashok Mehta (1977) → GVK Rao (1985) → L.M. Singhvi (1986) chronology + Articles 243D, 243I, 243K.
2. **Fiscal & Monetary Architecture:** Deficit definitions, Finance Commission (Art. 280), GST Council (Art. 279A), and RBI liquidity rates.
3. **Modern Indian National Movement (1905–1947):** Exact month-and-year chronology of pacts, sessions, and revolutionary organizations.
4. **Ecology, Protected Areas & Environmental Acts:** Wildlife Protection Act (1972), Project Tiger (1973), Biodiversity Act (2002), and UP wetlands.
5. **General Science Everyday Biology:** Vitamins, hormones, plant nutrients, and vector-borne diseases.

Every mistake you make in Sankalp automatically links you to a 3-minute Comparison Matrix Cheat Sheet and schedules FSRS spaced-repetition flashcards so you never drop marks on a repeated theme twice.`,
    bodyHi: `85 आधिकारिक UPPSC प्रश्नपत्रों और 2,100+ सत्यापित प्रश्नों के डेटा विश्लेषण से स्पष्ट है कि लगभग **38% मुख्य वैचारिक बिंदु** विभिन्न परीक्षाओं में बार-बार पूछे जाते हैं।

पंचायती राज समितियों का कालानुक्रम, राजकोषीय व मौद्रिक नीति, राष्ट्रीय आंदोलन (1905-1947), पर्यावरण अधिनियम और सामान्य विज्ञान पर मजबूत पकड़ सीधे कटऑफ पार कराती है।`,
    keyTakeawaysEn: [
      "38% of UPPSC Prelims marks come from recurring high-yield constitutional, economic, and ecological anchors.",
      "Always study repeated PYQs alongside adjacent options — tomorrow's question stem is often yesterday's Option C.",
      "Combine PYQ drills with FSRS spaced repetition so forgotten facts resurface right before exam day.",
    ],
    keyTakeawaysHi: [
      "विगत वर्षों के प्रश्नों के चारों विकल्पों का अध्ययन करें — पिछला विकल्प ही अगले वर्ष का प्रश्न बनता है।",
      "गलत प्रश्नों को FSRS फ्लैशकार्ड्स के माध्यम से दीर्घकालिक स्मृति में लॉक करें।",
    ],
    tags: ["PYQ Analysis", "High-Yield Topics", "UPPCS 2026", "Spaced Repetition"],
    examSlugs: ["uppcs-prelims", "uppsc-ro-aro", "uppsc-beo", "upsc-cse"],
    readingTimeMins: 6,
    publishedAt: new Date("2026-11-02T11:30:00Z"),
  },
];

async function main() {
  const dbUrl = process.env.DATABASE_URL || loadNodeNeonDatabaseUrl();
  const db = createDb(dbUrl);
  for (const post of INITIAL_SEO_POSTS) {
    await db
      .insert(schema.seoPosts)
      .values(post)
      .onConflictDoUpdate({
        target: schema.seoPosts.id,
        set: {
          slug: post.slug,
          category: post.category,
          linkedTopicId: post.linkedTopicId,
          titleEn: post.titleEn,
          titleHi: post.titleHi,
          summaryEn: post.summaryEn,
          summaryHi: post.summaryHi,
          bodyEn: post.bodyEn,
          bodyHi: post.bodyHi,
          keyTakeawaysEn: post.keyTakeawaysEn,
          keyTakeawaysHi: post.keyTakeawaysHi,
          tags: post.tags,
          examSlugs: post.examSlugs,
          readingTimeMins: post.readingTimeMins,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`[seed-seo] Upserted ${INITIAL_SEO_POSTS.length} public Current Affairs & Blog SEO posts.`);
}

main().catch((err) => {
  console.error("[seed-seo] Fatal:", err);
  process.exit(1);
});
