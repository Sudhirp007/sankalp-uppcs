import { desc, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import * as schema from "../db/schema";

const SITE_ORIGIN = "https://uppcs.mockexamonline.com";
const BRAND_NAME = "Sankalp by MockExamOnline";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRobotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

export async function buildSitemapXml(db: ReturnType<typeof createDb>): Promise<string> {
  const posts = await db
    .select({
      slug: schema.seoPosts.slug,
      category: schema.seoPosts.category,
      updatedAt: schema.seoPosts.updatedAt,
    })
    .from(schema.seoPosts)
    .where(eq(schema.seoPosts.isPublished, true))
    .orderBy(desc(schema.seoPosts.publishedAt));

  const today = new Date().toISOString().split("T")[0];

  const staticRoutes: Array<{ path: string; priority: string; changefreq: string }> = [
    { path: "/", priority: "1.0", changefreq: "daily" },
    { path: "/current-affairs", priority: "0.95", changefreq: "daily" },
    { path: "/blog", priority: "0.90", changefreq: "daily" },
    { path: "/pyq-bank", priority: "0.90", changefreq: "weekly" },
    { path: "/pricing", priority: "0.85", changefreq: "weekly" },
    { path: "/exams/uppcs-prelims", priority: "0.92", changefreq: "weekly" },
    { path: "/exams/uppsc-ro-aro", priority: "0.92", changefreq: "weekly" },
    { path: "/exams/uppsc-beo", priority: "0.85", changefreq: "weekly" },
    { path: "/exams/upsc-cse", priority: "0.88", changefreq: "weekly" },
    { path: "/about", priority: "0.60", changefreq: "monthly" },
    { path: "/contact", priority: "0.60", changefreq: "monthly" },
    { path: "/privacy-policy", priority: "0.40", changefreq: "monthly" },
    { path: "/terms", priority: "0.40", changefreq: "monthly" },
    { path: "/refund-policy", priority: "0.40", changefreq: "monthly" },
  ];

  const urlsXml = [
    ...staticRoutes.map(
      (r) => `  <url>
    <loc>${SITE_ORIGIN}${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
    ),
    ...posts.map((p) => {
      const prefix = p.category === "CURRENT_AFFAIRS" ? "/current-affairs/" : "/blog/";
      const lastmod = new Date(p.updatedAt).toISOString().split("T")[0];
      return `  <url>
    <loc>${SITE_ORIGIN}${prefix}${escapeHtml(p.slug)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
  </url>`;
    }),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`;
}

interface RouteSeoMeta {
  title: string;
  description: string;
  canonicalPath: string;
  ogType: "website" | "article";
  robots: string;
  jsonLd: Record<string, unknown>;
  ssrBodyHtml: string;
}

const EXAM_SEO_MAP: Record<
  string,
  { name: string; title: string; desc: string; cutoff: string; marking: string }
> = {
  "uppcs-prelims": {
    name: "UPPCS Combined State / Upper Subordinate Prelims",
    title: "UPPCS Prelims Mock Test Series 2026, Official PYQs & Adaptive Drills | MockExamOnline",
    desc: "Practice 2,100+ verified UPPCS Prelims PYQs & concept drills in pure English or Hindi medium with +1.33 / -0.44 marking, 50-50 elimination analytics, and FSRS flashcards.",
    cutoff: "Safe Target: 92+ Net Marks / 200",
    marking: "+1.33 Correct / -0.44 Wrong (150 Questions, 2 Hours)",
  },
  "uppsc-ro-aro": {
    name: "UPPSC RO / ARO (Samiksha Adhikari) Prelims",
    title: "UPPSC RO/ARO Mock Test Series, GS + 60 Marks General Hindi PYQ Bank | MockExamOnline",
    desc: "Targeted UPPSC RO/ARO Prelims preparation with 140 GS + 60 General Hindi practice sets, 1/3rd negative marking calibration, and high-yield UP Special cheat sheets.",
    cutoff: "Safe Target: 132+ Net Marks / 200",
    marking: "+1.00 Correct / -0.33 Wrong (GS 140 + Hindi 60)",
  },
  "uppsc-beo": {
    name: "UPPSC Block Education Officer (BEO)",
    title: "UPPSC BEO Mock Tests & Previous Year Question Papers with Solutions | MockExamOnline",
    desc: "Prepare for UPPSC Block Education Officer (Khand Shiksha Adhikari) with official commission answer-key verified PYQs, Indian Economy & Polity drills, and spaced repetition.",
    cutoff: "Safe Target: 185+ Net Marks / 300",
    marking: "+2.50 Correct / -0.83 Wrong (120 Questions)",
  },
  "upsc-cse": {
    name: "UPSC Civil Services (IAS) Prelims GS Paper I",
    title: "UPSC CSE Prelims GS Mock Tests, Statement Traps & Elimination Practice | MockExamOnline",
    desc: "Sharpen multi-statement, Assertion-Reason, and How-Many-Pairs accuracy for UPSC Civil Services Prelims with +2.00 / -0.67 grading and FSRS mistake retention.",
    cutoff: "Safe Target: 95+ Net Marks / 200",
    marking: "+2.00 Correct / -0.67 Wrong (100 Questions)",
  },
};

export async function resolveRouteSeo(
  pathname: string,
  db: ReturnType<typeof createDb>
): Promise<RouteSeoMeta> {
  const cleanPath = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");

  // 1. Individual Current Affairs or Blog Article
  if (cleanPath.startsWith("/current-affairs/") || cleanPath.startsWith("/blog/")) {
    const slug = cleanPath.split("/").pop() || "";
    const [post] = await db
      .select()
      .from(schema.seoPosts)
      .where(eq(schema.seoPosts.slug, slug))
      .limit(1);

    if (post) {
      const prefix = post.category === "CURRENT_AFFAIRS" ? "/current-affairs/" : "/blog/";
      const canonicalPath = `${prefix}${post.slug}`;
      return {
        title: `${post.titleEn} | ${BRAND_NAME}`,
        description: post.summaryEn,
        canonicalPath,
        ogType: "article",
        robots: "index, follow, max-image-preview:large",
        jsonLd: {
          "@context": "https://schema.org",
          "@type": post.category === "CURRENT_AFFAIRS" ? "NewsArticle" : "BlogPosting",
          headline: post.titleEn,
          description: post.summaryEn,
          datePublished: new Date(post.publishedAt).toISOString(),
          dateModified: new Date(post.updatedAt).toISOString(),
          author: { "@type": "Organization", name: BRAND_NAME, url: SITE_ORIGIN },
          publisher: { "@type": "Organization", name: BRAND_NAME, url: SITE_ORIGIN },
          mainEntityOfPage: `${SITE_ORIGIN}${canonicalPath}`,
        },
        ssrBodyHtml: `<article><h1>${escapeHtml(post.titleEn)}</h1><h2>${escapeHtml(
          post.titleHi
        )}</h2><p>${escapeHtml(post.summaryEn)}</p><div>${escapeHtml(post.bodyEn)}</div></article>`,
      };
    }
  }

  // 2. Exam Silo Pages (/exams/:slug)
  if (cleanPath.startsWith("/exams/")) {
    const examSlug = cleanPath.replace("/exams/", "");
    const ex = EXAM_SEO_MAP[examSlug] || EXAM_SEO_MAP["uppcs-prelims"]!;
    return {
      title: ex.title,
      description: ex.desc,
      canonicalPath: `/exams/${examSlug}`,
      ogType: "website",
      robots: "index, follow, max-image-preview:large",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Course",
        name: `${ex.name} Adaptive Test Series & PYQ Engine`,
        description: ex.desc,
        provider: { "@type": "EducationalOrganization", name: BRAND_NAME, sameAs: SITE_ORIGIN },
      },
      ssrBodyHtml: `<section><h1>${escapeHtml(ex.name)}</h1><p>${escapeHtml(
        ex.desc
      )}</p><p>${escapeHtml(ex.marking)} • ${escapeHtml(ex.cutoff)}</p></section>`,
    };
  }

  // 3. Current Affairs Hub
  if (cleanPath === "/current-affairs") {
    return {
      title: "Daily UPPSC & UPSC Current Affairs 2026 (English & Hindi) | MockExamOnline",
      description:
        "Daily high-yield Current Affairs digests for UPPCS Prelims, RO/ARO, and Civil Services — UP Budget, RBI Monetary Policy, Ramsar Wetlands, and Government Schemes with linked MCQs.",
      canonicalPath: "/current-affairs",
      ogType: "website",
      robots: "index, follow, max-image-preview:large",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Daily UPPSC & Civil Services Current Affairs",
        url: `${SITE_ORIGIN}/current-affairs`,
      },
      ssrBodyHtml:
        "<section><h1>Daily UPPSC & Civil Services Current Affairs 2026</h1><p>Bilingual English & Hindi Current Affairs digests linked directly to practice MCQs and spaced-repetition flashcards.</p></section>",
    };
  }

  // 4. Strategy Blog Hub
  if (cleanPath === "/blog") {
    return {
      title: "UPPCS & RO/ARO Preparation Strategy Blog, Cutoff Analysis & Topper Playbooks | MockExamOnline",
      description:
        "Data-backed preparation articles on clearing UPPCS Prelims, RO/ARO 200-marks blueprint, 50-50 elimination math under 1/3rd negative marking, and PYQ repeat trends.",
      canonicalPath: "/blog",
      ogType: "website",
      robots: "index, follow, max-image-preview:large",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "Sankalp UPPSC & Civil Services Strategy Blog",
        url: `${SITE_ORIGIN}/blog`,
      },
      ssrBodyHtml:
        "<section><h1>UPPCS & Civil Services Strategy Blog</h1><p>Data-backed guides on negative marking, 50-50 elimination, and high-yield UPPSC micro-topics.</p></section>",
    };
  }

  // 5. PYQ Question Bank Directory
  if (cleanPath === "/pyq-bank") {
    return {
      title: "UPPSC Previous Year Question Bank (2,100+ Official Key Verified MCQs) | MockExamOnline",
      description:
        "Explore 2,118+ official answer-key verified UPPSC & Civil Services questions across Indian Economy (1,293 Qs), Polity, History, Geography, Environment, and UP Special.",
      canonicalPath: "/pyq-bank",
      ogType: "website",
      robots: "index, follow, max-image-preview:large",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "Sankalp Verified UPPSC & Civil Services Question Bank",
        description: "2,118+ bilingual single-medium questions mapped to 3-tier UPPSC syllabus.",
      },
      ssrBodyHtml:
        "<section><h1>Verified UPPSC & Civil Services PYQ Bank</h1><p>2,118+ official answer-key verified questions across 85 UPPSC papers.</p></section>",
    };
  }

  // 6. Pricing (Freemium vs Pro Pass)
  if (cleanPath === "/pricing") {
    return {
      title: "Freemium & Pro Pass Pricing — Start Free Forever or Unlock Unlimited Mocks | MockExamOnline",
      description:
        "Compare Sankalp's ₹0 Free Forever Starter Plan with Sankalp Pro Pass (₹499/year) for unlimited 85+ UPPSC papers, 50-50 guesswork analytics, and Mistake FSRS flashcards.",
      canonicalPath: "/pricing",
      ogType: "website",
      robots: "index, follow",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Sankalp Pricing — Free vs Pro Pass",
        url: `${SITE_ORIGIN}/pricing`,
      },
      ssrBodyHtml:
        "<section><h1>Choose Free Forever (₹0) or Sankalp Pro Pass (₹499/year)</h1></section>",
    };
  }

  // 7. Legal, About & Contact Pages (Required for SEO E-E-A-T & Razorpay Live KYC)
  const staticPages: Record<string, { title: string; desc: string }> = {
    "/about": {
      title: "About Sankalp & MockExamOnline — Adaptive Civil Services Preparation",
      desc: "Learn how Sankalp combines 85+ official UPPSC papers, strict single-language English/Hindi switching, 50-50 elimination math, and FSRS spaced repetition.",
    },
    "/contact": {
      title: "Contact Us & Student Support | MockExamOnline",
      desc: "Get in touch with MockExamOnline support for UPPCS & RO/ARO test series queries, institutional partnerships, and billing assistance.",
    },
    "/privacy-policy": {
      title: "Privacy Policy | MockExamOnline",
      desc: "How MockExamOnline protects your personal data, learning telemetry, Firebase authentication, and Razorpay payment security.",
    },
    "/terms": {
      title: "Terms & Conditions | MockExamOnline",
      desc: "Terms of service governing Free Forever accounts and Sankalp Pro Pass subscriptions on MockExamOnline.com.",
    },
    "/refund-policy": {
      title: "Cancellation & Refund Policy | MockExamOnline",
      desc: "Transparent 7-day satisfaction & refund policy for Sankalp Pro Pass digital subscriptions on MockExamOnline.com.",
    },
  };

  if (staticPages[cleanPath]) {
    return {
      title: staticPages[cleanPath]!.title,
      description: staticPages[cleanPath]!.desc,
      canonicalPath: cleanPath,
      ogType: "website",
      robots: "index, follow",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: staticPages[cleanPath]!.title,
        url: `${SITE_ORIGIN}${cleanPath}`,
      },
      ssrBodyHtml: `<section><h1>${escapeHtml(staticPages[cleanPath]!.title)}</h1><p>${escapeHtml(
        staticPages[cleanPath]!.desc
      )}</p></section>`,
    };
  }

  // 8. Private / Interactive App Workspace (/app)
  if (cleanPath.startsWith("/app")) {
    return {
      title: "Sankalp Learning Workspace — Adaptive UPPSC Cockpit | MockExamOnline",
      description: "Interactive UPPSC & RO/ARO Adaptive Practice Cockpit, Learning Studio, and FSRS Flashcards.",
      canonicalPath: "/app",
      ogType: "website",
      robots: "noindex, follow",
      jsonLd: { "@context": "https://schema.org", "@type": "WebApplication", name: "Sankalp App" },
      ssrBodyHtml: "",
    };
  }

  // 9. Default Flagship Homepage (/)
  return {
    title: "MockExamOnline (Sankalp) — #1 Adaptive UPPCS, RO/ARO & UPSC Mock Test Engine (Free & Pro)",
    description:
      "Clear UPPCS Prelims & RO/ARO with 2,118+ official-key PYQs, strict single-language English or Hindi mode, +1.33/-0.44 50-50 elimination analytics, Cheat Sheets & Daily Current Affairs. Start Free!",
    canonicalPath: "/",
    ogType: "website",
    robots: "index, follow, max-image-preview:large",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "EducationalOrganization",
          name: BRAND_NAME,
          url: SITE_ORIGIN,
          description:
            "Adaptive UPPSC PCS, RO/ARO, BEO & Civil Services Exam Preparation Platform with Official Answer-Key Provenance and Spaced Repetition.",
        },
        {
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Can I practice UPPCS & RO/ARO mock tests for free on MockExamOnline?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes! Our ₹0 Free Forever plan includes daily 15-minute Adaptive Smart Drills, starter official PYQ papers, Cheat Sheets, and all Daily Current Affairs & Strategy Blogs.",
              },
            },
            {
              "@type": "Question",
              name: "Does Sankalp show questions in cluttered bilingual text or clean single language?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Sankalp enforces a strict single-language experience: choose English or Hindi (Devanagari) in 1 click and read every question stem, option, cheat sheet, and flashcard purely in your chosen medium.",
              },
            },
          ],
        },
      ],
    },
    ssrBodyHtml: `<main><h1>Crack UPPCS Prelims & RO/ARO with Scientific 50-50 Elimination & Mistake-Driven Spaced Repetition</h1><p>Practice 2,118+ Official Commission PYQs & Concept Builders in pure English or Hindi medium. Choose our ₹0 Free Forever Starter Plan or unlock Unlimited Pro Pass at ₹499/year.</p></main>`,
  };
}

export async function injectEdgeSeoIntoHtml(
  baseHtml: string,
  pathname: string,
  db: ReturnType<typeof createDb>
): Promise<string> {
  const meta = await resolveRouteSeo(pathname, db);
  const canonicalUrl = `${SITE_ORIGIN}${meta.canonicalPath}`;

  const seoHeadBlock = `
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <meta name="robots" content="${meta.robots}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:site_name" content="${BRAND_NAME}" />
    <meta property="og:type" content="${meta.ogType}" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${SITE_ORIGIN}/media/og-cover.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    <script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`;

  let enriched = baseHtml.replace(/<title>.*?<\/title>/i, seoHeadBlock);
  if (meta.ssrBodyHtml) {
    enriched = enriched.replace(
      '<div id="root"></div>',
      `<div id="root"></div><noscript>${meta.ssrBodyHtml}</noscript>`
    );
  }
  return enriched;
}
