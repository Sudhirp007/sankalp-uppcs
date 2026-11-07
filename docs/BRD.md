# Business Requirements Document (BRD)
## Product: Sankalp — Adaptive Civil Services & UPPSC Learning Platform

**Document Version:** 1.0  
**Date:** November 7, 2026  
**Status:** Committed Baseline Scope  

---

## 1. Executive Summary & Product Vision

**Sankalp** is a specialized, adaptive exam-preparation platform built initially for **Uttar Pradesh Public Service Commission (UPPSC)** examinations (*UPPCS Prelims, RO/ARO, ACF/RFO, GIC Lecturer, BEO, Assistant Professor*) and extensible to broader State PSC and UPSC tracks.

Unlike traditional mock-test portals that dump static PDFs or cluttered bilingual text onto students, Sankalp combines **6,800+ (scaling to 18,000+) AI-enriched Previous Year Questions (PYQs)** with **Concept-Builder Questions, High-Yield Cheat Sheets, Active-Recall Flashcards, and a Dual-Layer Mastery Engine** that tracks:
1. **Dedicated Per-Exam Learning Journeys** (tailored to each exam's exact syllabus weightage, cutoff trends, and negative-marking rules), and
2. **Unified Global Cross-Exam Expertise** (a single skill graph showing the student which exams they are already strong enough to crack and which exams have critical syllabus gaps).

---

## 2. Core Product Principles (Non-Negotiables)

1. **Strict Single-Language Experience (Zero Dual-Language Clutter):**
   - During onboarding (or anytime in Profile Settings), the student chooses their preferred medium: **English (`EN`)** or **Hindi (`HI`)**.
   - Every screen, question stem, option, explanation, cheat sheet, and flashcard renders **exclusively in the student's chosen language**. Students never have to visually parse mixed English/Hindi columns unless they explicitly switch their profile language.
2. **Separate Journey Per Exam + Global Cross-Exam Intelligence:**
   - A student preparing simultaneously for **UPPCS Prelims** and **RO/ARO** gets a dedicated workspace/journey for each exam (separate test history, syllabus progress, and cutoff readiness).
   - However, knowledge is not siloed: answering *Indian Polity* questions inside the RO/ARO journey updates the student's **Global Topic Mastery**, automatically recalculating their readiness across UPPCS Prelims, ACF/RFO, GIC, and other UPPSC exams.
3. **Beyond PYQs — Continuous Question Bank Expansion:**
   - While Official PYQs (2017–2025+) anchor the platform in authentic exam patterns, the platform natively supports **Concept-Builder MCQs**, **NCERT Foundation Drills**, **Current Affairs MCQs**, and **Simulated Full-Length Mock Papers** to close conceptual gaps where PYQs alone are insufficient.
4. **Closed-Loop Learning (Test → Diagnose → Learn via Cheat Sheet → Retain via Flashcards):**
   - Getting a question wrong does not end at reading a solution. Every micro-topic links directly to **3-Minute Cheat Sheets**, **Comparison Tables**, and **Spaced-Repetition (SRS) Flashcards** so mistakes turn into permanent retention.

---

## 3. Target User Personas

| Persona | Profile | Primary Pain Point Solved |
| :--- | :--- | :--- |
| **The Focused Hindi-Medium Aspirant** | Prepares in pure Hindi for UPPCS & RO/ARO | Eliminates broken OCR Hindi and distracting English-first interfaces; delivers crisp Devanagari questions, explanations, cheat sheets, and flashcards. |
| **The Working Professional / Time-Starved Aspirant** | Has 30–45 mins/day on weekdays, 3 hours on weekends | Daily 15-minute Adaptive Smart Drills + 3-minute Topic Cheat Sheets maximize marks-per-hour without hunting through bulky books. |
| **The Multi-Exam UPPSC Aspirant** | Appears for PCS Prelims, RO/ARO, BEO, and ACF/RFO in the same cycle | Global Expertise Matrix reveals exact cross-exam strengths (e.g., *"81% Ready for RO/ARO; need Economy & Environment push for PCS"*). |
| **The Repeat Prelims Candidate** | Misses cutoff by 3–8 marks due to negative marking on multi-statement questions | 50-50 Option Elimination strikethrough tool + Guesswork Net-Gain Analytics calibrate attempt strategy and eliminate negative-marking bleed. |

---

## 4. Functional Scope & Feature Commitments

### 4.1 User Profile, Medium & Multi-Exam Onboarding
- **Language Preference (`preferred_language`):** Mandatory selection of `EN` or `HI` at signup; instant toggle in Profile Settings that switches all content payloads system-wide.
- **Exam Enrollment:** Students select one or more target exams (e.g., *UPPCS PCS*, *UPPSC RO/ARO*, *ACF/RFO*, *GIC Lecturer*) and set one as their **Active Exam Context**, switchable via a persistent top-bar switcher.
- **Daily Study Goal:** Configurable target (e.g., 20, 45, or 90 mins/day) driving daily streak and SRS queue sizing.

### 4.2 Per-Exam Learning Journey Dashboard
Each enrolled exam provides an isolated, exam-specific dashboard displaying:
- **Exam Readiness Score (0–100%) & Cutoff Margin Indicator:** Weighted against that specific exam's historical topic distribution (e.g., RO/ARO weights General Hindi + GS differently than UPPCS GS-I).
- **Syllabus Coverage Meter:** Percentage of L2/L3 syllabus micro-topics practiced and mastered for that exam.
- **Today's Smart Action Queue:** 1-click launch into overdue SRS Mistake Cards, Weak-Topic Drills, or the next unattempted Official PYQ Paper for that exam.
- **Mock & PYQ Paper History:** Chronological score trend, accuracy %, negative marks lost, and percentile/cutoff comparison.

### 4.3 Global Expertise & Cross-Exam Readiness Portfolio
A dedicated **"Global Expertise"** hub synthesizing all user activity across the platform:
- **Exam Strength Leaderboard (Strong vs. Weak Exams):** Ranks all UPPSC exams by the student's current weighted readiness—highlighting *Stronghold Exams* (e.g., RO/ARO 79%, GIC GS 76%) vs. *Vulnerable Exams* (e.g., UPPCS Prelims 54%).
- **Cross-Subject Mastery Radar:** Unified ELO/mastery score across core pillars (*Polity, Modern/Ancient/Medieval History, Geography, Economy, General Science, Environment, UP Special GK, General Hindi, Aptitude*).
- **Cognitive & Format Skill Breakdown:** Accuracy segmented by question format (*Single-Choice Factual*, *Multi-Statement I/II/III*, *Assertion–Reason*, *Match List-I & II*, *Chronological Ordering*) to expose structural test-taking weaknesses.

### 4.4 3-Tier Syllabus Explorer & Custom Practice Configurator
- **Canonical 3-Level Knowledge Tree:** `Subject (L1) -> Theme/Chapter (L2) -> Micro-Concept (L3)` (e.g., `Indian Polity -> Local Government -> Panchayati Raj`).
- **Multi-Source Question Filtering:**
  - *Question Origin:* Official PYQs | Concept Builders | NCERT Drills | Current Affairs | All
  - *Difficulty:* Easy | Medium | Hard
  - *High-Yield Filter:* "Repeated Across UPPSC Exams" (`question_variants >= 1`) and "Unseen / Previously Wrong"

### 4.5 Distraction-Free 3-Column Exam Test Cockpit
- **Left Column (Context & Filters):** Paper/Drill metadata, marking rules (`+1.33 / -0.44` or exam-specific), section jumper, and quick status filters (*Unattempted*, *Marked for Review*).
- **Center Column (Single-Language Question Stage & Solving Tools):**
  - Clean monolingual stem (preserving multi-statement lists and Match tables) and 4 option cards (`A–D`).
  - **50-50 Option Elimination Strikethrough:** Click/shortcut to visually cross out ruled-out distractors during multi-statement deduction.
  - **Attempt Confidence Tagger:** Optional 1-click tag (*100% Sure* vs *50-50 Educated Guess* vs *Wild Guess*) captured per attempt for post-test guesswork auditing.
- **Right Column (Live OMR Palette & Timer):** Countdown timer, color-coded 1–150 question bubble grid, summary counters, and Submit confirmation modal.

### 4.6 Post-Test Deep Review & Answer Key Provenance
- **Exact Commission Grading:** Handles standard negative marking (1/3rd) and Commission-deleted/bonus questions (`correct_option = 'X'`).
- **Guesswork Audit Card:** Reveals net marks gained or lost specifically on *50-50 Educated Guesses* vs *100% Sure* attempts.
- **Authoritative Single-Language Explanations + Golden Rule:** Displays why the answer is right, why distractors fail, and a 1-sentence **Key Takeaway** box.
- **Answer Provenance & Dispute Transparency:** Badges indicating `Official Final Key`, `Coaching Consensus`, `Disputed Question` (with conflicting key notes from `dispute_logs`), and `AI-Verified`.
- **Cross-Exam Repeat Lineage:** Badges showing every past UPPSC paper/year where the exact question appeared.
- **1-Click Remediation:** Direct buttons on every wrong question to *"Open Topic Cheat Sheet"* or *"Save Key Takeaway to Flashcards"*.

### 4.7 Learning Studio: Cheat Sheets, Concept Notes & Flashcards
- **Topic Cheat Sheets (`CHEAT_SHEET` / `COMPARISON_TABLE` / `TIMELINE`):** Concise, scannable revision sheets in the user's preferred language summarizing high-frequency articles, amendments, committees, treaties, and chronological events—annotated with how many PYQs they cover.
- **Active-Recall Flashcards & Mistake Deck:**
  - Supports Question/Answer, Cloze (fill-in-the-blank), and Article/Fact matching cards.
  - Automatically queues mistakes from tests alongside topic flashcards using an **SM-2 / FSRS spaced-repetition scheduler** (*Again, Hard, Good, Easy*).

---

## 5. Content & Data Readiness Summary

| Asset / Capability | Current State (`harvester.db`) | Target Production State |
| :--- | :--- | :--- |
| **Official UPPSC PDFs (2017–2025)** | **190 PDFs downloaded** (60 parsed, 89 objective queued, 41 Mains cataloged) | 149 Objective PDFs 100% parsed & normalized (~18,000+ instances) |
| **Enriched Unique Questions** | **6,838+ unique MCQs** (99% bilingual `EN` + `HI` stems, options, explanations) | 100% Hindi backfill on remaining 67 `EN`-only rows + ongoing Concept-Builder expansion |
| **3-Tier Topic Tagging** | Present as text strings (`Subject -> Theme -> Concept`) | Normalized into `syllabus_topics` & mapped per exam via `exam_syllabus_map` |
| **Cheat Sheets & Flashcards** | Not yet generated | Synthesized via Gemini pipeline per `syllabus_topics` node from PYQ clusters |

---

## 6. Phased Delivery Roadmap

### Phase 1: Data Migration & Core Test Engine (MVP)
- Normalize `syllabus_topics` and `exams` from `harvester.db` and migrate to **Neon Serverless PostgreSQL** (`migrate_sqlite_to_neon.ts`).
- Build Hono.js + Cloudflare Workers Edge API with Firebase Auth and single-language payload projection (`EN` / `HI`).
- Launch Onboarding, Per-Exam Dashboard, 3-Tier Syllabus Explorer, 3-Column Test Cockpit (with 50-50 strikethrough), and Post-Test Review.

### Phase 2: Global Cross-Exam Expertise & SRS Mistake Loop
- Enable `user_topic_mastery` ELO calculation and `exam_syllabus_map` weightage roll-ups.
- Launch the **Global Expertise Hub** (Strong vs. Weak Exams matrix + Question-Format Analytics) and Daily Adaptive Drill (`/api/v1/questions/adaptive-drill`).

### Phase 3: Learning Studio (Cheat Sheets, Flashcards & Non-PYQ Expansion)
- Run batch synthesis over PYQ clusters to populate bilingual `learning_artifacts` (Cheat Sheets & Comparison Tables) and `flashcards`.
- Launch the **Topic Learning Studio**, **SRS Flashcard Player**, and **Concept-Builder / NCERT Question** ingestion pipeline.

---

## 7. Key Success Metrics (OKRs)
1. **Learning Velocity:** Measurable accuracy lift (+15% within 30 days) on repeated micro-topics after Cheat Sheet + SRS Flashcard intervention.
2. **Negative-Marking Reduction:** 25% reduction in avoidable negative marks among repeat test-takers using the 50-50 Elimination & Confidence Tagger tools.
3. **Daily Habit Retention:** >40% D7 retention driven by the 15-minute Daily Adaptive Smart Drill and Flashcard streak loop.
4. **Zero Language Friction:** 100% single-language rendering parity across `EN` and `HI` without untranslated fallbacks.
