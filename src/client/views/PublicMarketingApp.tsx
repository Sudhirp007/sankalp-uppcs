import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Award,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crown,
  Database,
  Film,
  Flame,
  Globe2,
  GraduationCap,
  Layers,
  Lock,
  Newspaper,
  Play,
  Scissors,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserCircle2,
  XCircle,
} from "lucide-react";
import type { User as FirebaseUser } from "firebase/auth";
import {
  api,
  type PublicHomeResponse,
  type PublicPostDetailResponse,
  type PublicPostSummary,
} from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface PublicMarketingAppProps {
  pathname: string;
  lang: LangCode;
  fbUser: FirebaseUser | null;
  planTier: "FREE" | "PRO_PASS";
  onToggleLanguage: () => Promise<void>;
  onNavigate: (path: string) => void;
  onEnterFreeApp: (opts?: { examId?: string; topicId?: string }) => Promise<void>;
  onOpenProCheckout: () => void;
  onOpenAuthModal: () => void;
}

export const PublicMarketingApp: React.FC<PublicMarketingAppProps> = ({
  pathname,
  lang,
  fbUser,
  planTier,
  onToggleLanguage,
  onNavigate,
  onEnterFreeApp,
  onOpenProCheckout,
  onOpenAuthModal,
}) => {
  const [homeData, setHomeData] = useState<PublicHomeResponse | null>(null);
  const [postsList, setPostsList] = useState<PublicPostSummary[]>([]);
  const [articleDetail, setArticleDetail] = useState<PublicPostDetailResponse | null>(null);
  const [loadingArticle, setLoadingArticle] = useState(false);

  // Hero Showcase Tabs: Interactive PYQ Simulator vs Flow/Pomelli Video Reel
  const [heroShowcaseTab, setHeroShowcaseTab] = useState<"SIMULATOR" | "FLOW_VIDEO">("SIMULATOR");
  const [flowVideoAvailable, setFlowVideoAvailable] = useState(true);
  const [demoSelected, setDemoSelected] = useState<string | null>(null);
  const [demoEliminated, setDemoEliminated] = useState<string[]>([]);

  const cleanPath = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");

  useEffect(() => {
    api
      .getPublicHome(lang)
      .then((res) => setHomeData(res))
      .catch(() => {});
  }, [lang]);

  useEffect(() => {
    if (cleanPath === "/current-affairs" || cleanPath === "/blog") {
      const cat = cleanPath === "/current-affairs" ? "CURRENT_AFFAIRS" : "BLOG";
      api
        .getPublicPosts(cat, lang)
        .then((res) => setPostsList(res.posts))
        .catch(() => {});
    } else if (cleanPath.startsWith("/current-affairs/") || cleanPath.startsWith("/blog/")) {
      const slug = cleanPath.split("/").pop() || "";
      setLoadingArticle(true);
      api
        .getPublicPostBySlug(slug, lang)
        .then((res) => setArticleDetail(res))
        .catch(() => setArticleDetail(null))
        .finally(() => setLoadingArticle(false));
    }
  }, [cleanPath, lang]);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onNavigate(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleDemoEliminate = (key: string) => {
    setDemoEliminated((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
    if (demoSelected === key) setDemoSelected(null);
  };

  // Render Pricing Comparison Section (reused on / and /pricing)
  const renderFreemiumPricingSection = () => {
    const annualPlan = homeData?.plans.find((p) => p.code.includes("ANNUAL")) || homeData?.plans[0];
    const boosterPlan = homeData?.plans.find((p) => p.id !== annualPlan?.id);

    return (
      <section id="pricing-plans" className="py-16 px-4 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-12">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200 px-3.5 py-1 text-xs font-extrabold text-[#1E3A8A] uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "HI" ? "पारदर्शी फ्रीमियम मॉडल" : "Transparent Freemium Model"}
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            {lang === "HI"
              ? "निःशुल्क शुरू करें, या असीमित आयोग प्रश्नपत्र अनलॉक करें"
              : "Start Free Forever, or Unlock Full Commission Mastery"}
          </h2>
          <p className="text-sm sm:text-base text-slate-600">
            {lang === "HI"
              ? "बिना किसी कार्ड के आज ही प्रैक्टिस शुरू करें। जब आप सभी 85+ आधिकारिक पेपर्स और मिस्टेक फ्लैशकार्ड्स के लिए तैयार हों, तब प्रो पास चुनें।"
              : "Experience single-language adaptive drills, Cheat Sheets, and Daily Current Affairs at ₹0. Upgrade only when you want unlimited full-length mocks & deep guesswork analytics."}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {/* Tier 1: Free Forever (Freemium Funnel Entry) */}
          <div className="rounded-3xl bg-white border-2 border-slate-200 p-7 flex flex-col justify-between shadow-xs">
            <div className="space-y-5">
              <div>
                <span className="inline-block text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                  {lang === "HI" ? "फ्री स्टार्टर (हमेशा निःशुल्क)" : "Free Starter • Forever"}
                </span>
                <h3 className="text-xl font-extrabold text-slate-900 mt-3">
                  {lang === "HI" ? "संकल्प बेसिक (Free)" : "Sankalp Free Edition"}
                </h3>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-mono-metric text-4xl font-extrabold text-slate-900">₹0</span>
                  <span className="text-xs text-slate-500">
                    {lang === "HI" ? "/ आजीवन निःशुल्क" : "/ forever • No card needed"}
                  </span>
                </div>
              </div>

              <ul className="space-y-3 text-xs sm:text-sm text-slate-700">
                {[
                  lang === "HI"
                    ? "असीमित 15-मिनट अनुकूली स्मार्ट ड्रिल्स"
                    : "Unlimited 15-Min Adaptive Smart Drills",
                  lang === "HI"
                    ? "2 पूर्ण-लंबाई आधिकारिक UPPSC प्रश्नपत्र"
                    : "2 Full-Length Official UPPSC Mock Papers",
                  lang === "HI"
                    ? "शुद्ध एकल-भाषा मोड (English या हिन्दी)"
                    : "Strict Single-Language Mode (Pure EN or Pure HI)",
                  lang === "HI"
                    ? "उच्च-उपयोगी तुलनात्मक चीट शीट्स"
                    : "Core 3-Min Comparison Matrix Cheat Sheets",
                  lang === "HI"
                    ? "दैनिक करेंट अफेयर्स एवं रणनीति ब्लॉग"
                    : "Full Daily Current Affairs & Strategy Blogs",
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={() => onEnterFreeApp()}
              className="mt-8 w-full inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#1E3A8A] text-[#1E3A8A] hover:bg-indigo-50 font-extrabold py-3.5 text-sm transition cursor-pointer"
            >
              <span>
                {lang === "HI" ? "निःशुल्क संस्करण चुनें →" : "Continue with Free Version →"}
              </span>
            </button>
          </div>

          {/* Tier 2: Flagship Annual Pro Pass (Most Popular Conversion Target) */}
          <div className="rounded-3xl bg-gradient-to-b from-[#1E3A8A] via-indigo-950 to-slate-950 text-white p-7 flex flex-col justify-between shadow-xl ring-4 ring-amber-400/40 relative">
            <div className="absolute -top-3.5 right-6 rounded-full bg-amber-400 text-slate-950 px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-wider shadow">
              {lang === "HI" ? "सर्वाधिक लोकप्रिय • सर्वोत्तम मूल्य" : "Most Popular • Best Value"}
            </div>

            <div className="space-y-5">
              <div>
                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-white/15 text-amber-300">
                  <Crown className="w-3.5 h-3.5" />
                  {annualPlan?.badge || "365 Days Unlimited"}
                </span>
                <h3 className="text-xl font-extrabold text-white mt-3">
                  {annualPlan?.name || "Sankalp Pro Pass (Annual)"}
                </h3>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono-metric text-4xl font-extrabold text-white">
                    ₹{annualPlan?.amountInr ?? 499}
                  </span>
                  <span className="text-xs text-indigo-200">
                    / {annualPlan?.validityDays ?? 365} {lang === "HI" ? "दिन (GST सहित)" : "days (₹1.36/day)"}
                  </span>
                </div>
              </div>

              <ul className="space-y-3 text-xs sm:text-sm text-indigo-100">
                {(
                  annualPlan?.features || [
                    "Unlimited access to all 85+ Official UPPSC Papers & 2,118+ Verified MCQs",
                    "Scientific 50-50 Elimination Net-Gain & Wild-Guess Drag Calibration",
                    "Automatic Mistake-to-Flashcard FSRS Spaced Repetition Queue",
                    "Unlimited Private Personal Flashcards & Cloud Revision Notes",
                    "Cross-Exam Readiness Portfolio (UPPCS + RO/ARO + BEO + UPSC)",
                  ]
                ).map((feat, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={onOpenProCheckout}
              className="mt-8 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold py-3.5 text-sm shadow-lg transition cursor-pointer"
            >
              <Crown className="w-4 h-4" />
              <span>
                {planTier === "PRO_PASS"
                  ? lang === "HI"
                    ? "प्रो पास सक्रिय (प्रबंधित करें)"
                    : "Pro Pass Active (Manage)"
                  : lang === "HI"
                    ? `प्रो पास चुनें (₹${annualPlan?.amountInr ?? 499}) →`
                    : `Select Paid Pro Pass (₹${annualPlan?.amountInr ?? 499}) →`}
              </span>
            </button>
          </div>

          {/* Tier 3: Seasonal Prelims Booster */}
          <div className="rounded-3xl bg-white border-2 border-slate-200 p-7 flex flex-col justify-between shadow-xs">
            <div className="space-y-5">
              <div>
                <span className="inline-block text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-amber-100 text-amber-900">
                  {boosterPlan?.badge || "Prelims Sprint"}
                </span>
                <h3 className="text-xl font-extrabold text-slate-900 mt-3">
                  {boosterPlan?.name || "Prelims Crash Booster"}
                </h3>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-mono-metric text-4xl font-extrabold text-slate-900">
                    ₹{boosterPlan?.amountInr ?? 299}
                  </span>
                  <span className="text-xs text-slate-500">
                    / {boosterPlan?.validityDays ?? 120} {lang === "HI" ? "दिन" : "days"}
                  </span>
                </div>
              </div>

              <ul className="space-y-3 text-xs sm:text-sm text-slate-700">
                {(
                  boosterPlan?.features || [
                    "Full UPPCS Prelims & RO/ARO Test Bank for upcoming cycle",
                    "1,293 Verified Indian Economy Special Drill Bank",
                    "Complete 50-50 Elimination Scorecard & Provenance Key",
                    "Mistake-Driven FSRS Active-Recall Deck",
                  ]
                ).map((feat, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-[#1E3A8A] shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={onOpenProCheckout}
              className="mt-8 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold py-3.5 text-sm transition cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>
                {lang === "HI"
                  ? `बूस्टर पास चुनें (₹${boosterPlan?.amountInr ?? 299})`
                  : `Get Booster Pass (₹${boosterPlan?.amountInr ?? 299})`}
              </span>
            </button>
          </div>
        </div>
      </section>
    );
  };

  // Sub-page Router for Public SEO Pages
  const renderRouteBody = () => {
    // A. Individual Current Affairs or Blog Article Reader
    if (cleanPath.startsWith("/current-affairs/") || cleanPath.startsWith("/blog/")) {
      if (loadingArticle) {
        return (
          <div className="max-w-4xl mx-auto py-20 px-4 text-center text-sm text-slate-500">
            Loading article...
          </div>
        );
      }
      if (!articleDetail) {
        return (
          <div className="max-w-3xl mx-auto py-20 px-4 text-center space-y-4">
            <h1 className="text-2xl font-bold text-slate-900">Article not found</h1>
            <button
              type="button"
              onClick={() => onNavigate("/current-affairs")}
              className="rounded-xl bg-[#1E3A8A] text-white px-4 py-2 text-xs font-bold cursor-pointer"
            >
              Browse Daily Current Affairs →
            </button>
          </div>
        );
      }

      const { post, relatedPosts } = articleDetail;
      const isCA = post.category === "CURRENT_AFFAIRS";

      return (
        <article className="max-w-4xl mx-auto px-4 lg:px-6 py-12 space-y-8">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <a
                href={isCA ? "/current-affairs" : "/blog"}
                onClick={(e) => handleLinkClick(e, isCA ? "/current-affairs" : "/blog")}
                className="font-bold text-[#1E3A8A] hover:underline"
              >
                ← {isCA ? "Daily Current Affairs" : "Strategy Blog"}
              </a>
              <span className="text-slate-300">•</span>
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Clock className="w-3.5 h-3.5" /> {post.readingTimeMins} min read
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500">
                {new Date(post.publishedAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 leading-tight">
              {post.title}
            </h1>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed">{post.summary}</p>

            <div className="flex flex-wrap gap-2">
              {post.tags.map((tag, i) => (
                <span
                  key={i}
                  className="text-xs font-semibold px-3 py-1 rounded-full bg-indigo-50 text-[#1E3A8A]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          {/* Exam Takeaways Box */}
          {post.keyTakeaways.length > 0 && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-6 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-950">
                <Sparkles className="w-4 h-4 text-amber-700" />
                {lang === "HI"
                  ? "प्रारंभिक परीक्षा मुख्य बिंदु (Prelims Pointer Lock)"
                  : "High-Yield Commission Pointers"}
              </div>
              <ul className="space-y-2 text-sm text-amber-950 font-medium">
                {post.keyTakeaways.map((pt, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Article Body */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 sm:p-10 space-y-4 text-slate-800 leading-relaxed whitespace-pre-line text-sm sm:text-base">
            {post.body}
          </div>

          {/* Direct Conversion CTA: Practice MCQs on This Exact Topic */}
          <div className="rounded-3xl bg-gradient-to-r from-[#1E3A8A] to-indigo-950 text-white p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-300">
                {lang === "HI" ? "सक्रिय अभ्यास में बदलें" : "Convert Reading Into Marks"}
              </div>
              <h3 className="text-lg font-extrabold">
                {lang === "HI"
                  ? "इस विषय पर आधारित आयोग के वास्तविक प्रश्न अभी हल करें"
                  : "Test Yourself on Official UPPSC PYQs From This Topic"}
              </h3>
            </div>
            <button
              type="button"
              onClick={() =>
                onEnterFreeApp({ topicId: post.linkedTopicId || undefined })
              }
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold px-5 py-3 text-xs sm:text-sm cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              {lang === "HI" ? "निःशुल्क टॉपिक ड्रिल शुरू करें →" : "Start Free Topic Drill →"}
            </button>
          </div>

          {/* Related Articles for Internal Link Crawlability */}
          {relatedPosts.length > 0 && (
            <div className="space-y-4 pt-4">
              <h3 className="font-extrabold text-lg text-slate-900">
                {lang === "HI" ? "संबंधित लेख एवं करेंट अफेयर्स" : "Continue Reading"}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {relatedPosts.map((rp) => {
                  const rpUrl =
                    rp.category === "CURRENT_AFFAIRS"
                      ? `/current-affairs/${rp.slug}`
                      : `/blog/${rp.slug}`;
                  return (
                    <a
                      key={rp.slug}
                      href={rpUrl}
                      onClick={(e) => handleLinkClick(e, rpUrl)}
                      className="rounded-2xl bg-white border border-slate-200 hover:border-[#1E3A8A] p-4 space-y-2 transition block"
                    >
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {rp.category.replace("_", " ")}
                      </span>
                      <div className="font-bold text-sm text-slate-900 leading-snug">
                        {rp.title}
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      );
    }

    // B. Current Affairs Hub (/current-affairs) or Blog Hub (/blog)
    if (cleanPath === "/current-affairs" || cleanPath === "/blog") {
      const isCA = cleanPath === "/current-affairs";
      return (
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-12 space-y-10">
          <div className="max-w-3xl space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-xs font-extrabold text-[#1E3A8A]">
              <Newspaper className="w-3.5 h-3.5" />
              {isCA
                ? lang === "HI"
                  ? "दैनिक यूपीपीसीएस एवं सिविल सेवा करेंट अफेयर्स"
                  : "Daily UPPSC & Civil Services Current Affairs"
                : lang === "HI"
                  ? "रणनीति, कटऑफ गणित एवं टॉपर गाइड्स"
                  : "Data-Backed Strategy & Cutoff Playbooks"}
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
              {isCA
                ? lang === "HI"
                  ? "परीक्षा-केंद्रित करेंट अफेयर्स (सीधे PYQ लिंकेज के साथ)"
                  : "Exam-Focused Current Affairs Linked Directly to MCQs"
                : lang === "HI"
                  ? "UPPCS एवं RO/ARO वैज्ञानिक तैयारी ब्लॉग"
                  : "UPPCS, RO/ARO & Prelims Mastery Blog"}
            </h1>
            <p className="text-sm sm:text-base text-slate-600">
              {isCA
                ? lang === "HI"
                  ? "अनावश्यक समाचारों के बजाय केवल वे तथ्य जो आयोग के कथन-आधारित और सुमेलन प्रश्नों में पूछे जाते हैं।"
                  : "Zero newspaper fluff — every digest isolates statutory facts, Uttar Pradesh budget metrics, and commission traps."
                : lang === "HI"
                  ? "85 आयोग प्रश्नपत्रों और 1/3 नकारात्मक अंकन के डेटा विश्लेषण पर आधारित लेख।"
                  : "Actionable analyses built from 85 official UPPSC papers, 50-50 elimination math, and spaced-repetition science."}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {postsList.map((post) => {
              const postUrl =
                post.category === "CURRENT_AFFAIRS"
                  ? `/current-affairs/${post.slug}`
                  : `/blog/${post.slug}`;
              return (
                <a
                  key={post.id}
                  href={postUrl}
                  onClick={(e) => handleLinkClick(e, postUrl)}
                  className="rounded-3xl bg-white border border-slate-200 hover:border-[#1E3A8A] p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-bold text-[#1E3A8A] uppercase text-[11px]">
                        {post.category.replace("_", " ")}
                      </span>
                      <span>{post.readingTimeMins} min read</span>
                    </div>
                    <h2 className="font-extrabold text-base text-slate-900 leading-snug">
                      {post.title}
                    </h2>
                    <p className="text-xs text-slate-600 leading-relaxed">{post.summary}</p>
                  </div>
                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-[#1E3A8A]">
                    <span>{lang === "HI" ? "पूरा लेख पढ़ें" : "Read Full Digest"}</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      );
    }

    // C. Dedicated Exam Silo Pages (/exams/:slug)
    if (cleanPath.startsWith("/exams/")) {
      const slug = cleanPath.replace("/exams/", "");
      const exam =
        homeData?.exams.find((e) => e.slug === slug || e.id === slug) || homeData?.exams[0];

      return (
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-12 space-y-12">
          <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-[#1E3A8A] to-indigo-950 text-white p-8 sm:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1 text-xs font-bold text-amber-300">
                <Target className="w-3.5 h-3.5" />
                {exam?.targetCycleLabel || "2026 Official Exam Blueprint"}
              </span>
              <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight">
                {exam?.name || "UPPCS Combined State (Prelims)"}{" "}
                {lang === "HI" ? "अनुकूली टेस्ट सीरीज़" : "Adaptive Test Series & PYQ Engine"}
              </h1>
              <p className="text-sm sm:text-base text-indigo-100 max-w-2xl leading-relaxed">
                {exam?.description ||
                  "Master official commission papers, strict single-language English or Hindi cockpit, +1.33 / -0.44 marking, and FSRS mistake retention."}
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onEnterFreeApp({ examId: exam?.id || "uppcs-prelims" })}
                  className="inline-flex items-center gap-2 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold px-6 py-3.5 text-sm cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {lang === "HI" ? "निःशुल्क मॉक ड्रिल शुरू करें" : "Start Free Exam Journey →"}
                </button>
                <button
                  type="button"
                  onClick={onOpenProCheckout}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/25 text-white font-bold px-6 py-3.5 text-sm cursor-pointer"
                >
                  <Crown className="w-4 h-4 text-amber-300" />
                  {lang === "HI" ? "प्रो पास अनलॉक करें" : "Unlock Unlimited Pro Pass"}
                </button>
              </div>
            </div>

            <div className="lg:col-span-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 border border-white/15 p-4">
                <div className="text-xs text-indigo-200">Questions / Marks</div>
                <div className="font-mono-metric text-2xl font-extrabold mt-1">
                  {exam?.totalQuestions ?? 150} Q / {exam?.maxMarks ?? 200}
                </div>
              </div>
              <div className="rounded-2xl bg-white/10 border border-white/15 p-4">
                <div className="text-xs text-indigo-200">Marking Scheme</div>
                <div className="font-mono-metric text-2xl font-extrabold text-emerald-300 mt-1">
                  +{exam?.positiveMarks ?? 1.33} / -{exam?.negativeMarks ?? 0.44}
                </div>
              </div>
              <div className="rounded-2xl bg-white/10 border border-white/15 p-4">
                <div className="text-xs text-indigo-200">Safe Cutoff Target</div>
                <div className="font-mono-metric text-2xl font-extrabold text-amber-300 mt-1">
                  {exam?.historicalCutoff ?? 90}+
                </div>
              </div>
              <div className="rounded-2xl bg-white/10 border border-white/15 p-4">
                <div className="text-xs text-indigo-200">Duration</div>
                <div className="font-mono-metric text-2xl font-extrabold mt-1">
                  {exam?.durationMins ?? 120} mins
                </div>
              </div>
            </div>
          </div>

          {renderFreemiumPricingSection()}
        </div>
      );
    }

    // D. PYQ Question Bank Directory (/pyq-bank)
    if (cleanPath === "/pyq-bank") {
      return (
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-12 space-y-10">
          <div className="max-w-3xl space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-800">
              <Database className="w-3.5 h-3.5" />
              {homeData?.stats.totalQuestions ?? 2118}+ Verified Commission Questions
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
              {lang === "HI"
                ? "आधिकारिक उत्तर-कुंजी सत्यापित UPPSC प्रश्न बैंक"
                : "Official Answer-Key Verified UPPSC & Civil Services Question Bank"}
            </h1>
            <p className="text-sm sm:text-base text-slate-600">
              {lang === "HI"
                ? "85+ आयोग प्रश्नपत्रों से संकलित एवं सूक्ष्म-विषयों में वर्गीकृत प्रश्न।"
                : "Indexed across 85 official commission papers with cross-paper repeat lineage and Golden Rule memory anchors."}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {(homeData?.subjectBreakdown || []).map((sub, i) => (
              <div
                key={i}
                className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="font-mono-metric text-2xl font-extrabold text-[#1E3A8A]">
                    {sub.count.toLocaleString()} MCQs
                  </div>
                  <h2 className="font-bold text-base text-slate-900 mt-1">{sub.subject}</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Verified with Official Commission Key & 50-50 Strikethrough Cockpit
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onEnterFreeApp()}
                  className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#1E3A8A] hover:underline cursor-pointer"
                >
                  Practice {sub.subject} Free →
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // E. Dedicated Pricing Route (/pricing)
    if (cleanPath === "/pricing") {
      return <div className="py-6">{renderFreemiumPricingSection()}</div>;
    }

    // F. Trust, About, Contact & Razorpay KYC Compliance Legal Pages
    if (
      ["/about", "/contact", "/privacy-policy", "/terms", "/refund-policy"].includes(cleanPath)
    ) {
      const legalContent: Record<string, { title: string; paragraphs: string[] }> = {
        "/about": {
          title: "About Sankalp (MockExamOnline.com)",
          paragraphs: [
            "MockExamOnline.com powers Sankalp — an adaptive exam preparation platform engineered specifically for UPPSC Combined State Services (UPPCS), Review Officer / Assistant Review Officer (RO/ARO), Block Education Officer (BEO), and UPSC Civil Services aspirants.",
            "Unlike cluttered bilingual portals that force students to read walls of mixed English-Hindi text, Sankalp provides a pure single-language experience alongside real +1.33 / -0.44 commission grading, scientific 50-50 elimination tracking, 3-minute Cheat Sheets, and FSRS spaced-repetition flashcards.",
          ],
        },
        "/contact": {
          title: "Contact Us & Aspirant Support",
          paragraphs: [
            "Website: https://mockexamonline.com",
            "Support Email: support@mockexamonline.com | Billing & Subscriptions: billing@mockexamonline.com",
            "Operating Hours: Monday to Saturday, 9:00 AM – 7:00 PM IST. All student billing or answer-key queries are resolved within 24 business hours.",
          ],
        },
        "/privacy-policy": {
          title: "Privacy Policy",
          paragraphs: [
            "MockExamOnline.com respects your privacy. We collect only essential account details (Name, Email, or Phone Number via Google Firebase Authentication) and your practice test telemetry (topic mastery, flashcards, and personal revision notes) to personalize your learning journey.",
            "Payment Safety: All subscription transactions are processed via Razorpay using PCI-DSS compliant encryption and HMAC-SHA256 verification. MockExamOnline never stores your card numbers, UPI PINs, or banking passwords.",
            "You may request complete export or deletion of your account data at any time by writing to support@mockexamonline.com.",
          ],
        },
        "/terms": {
          title: "Terms & Conditions",
          paragraphs: [
            "By accessing MockExamOnline.com, you agree to use the Free Forever Starter tier and Sankalp Pro Pass strictly for personal, non-commercial exam preparation.",
            "Account Sharing & Scraping: Automated scraping of our verified PYQ database, Cheat Sheets, or redistribution of subscription credentials is prohibited and may result in account suspension.",
            "Official Exam Disclaimer: MockExamOnline is an independent educational technology platform and is not affiliated with UPPSC or UPSC.",
          ],
        },
        "/refund-policy": {
          title: "Cancellation & Refund Policy",
          paragraphs: [
            "We offer a generous Free Forever tier so every aspirant can thoroughly evaluate Sankalp's Test Cockpit, Cheat Sheets, and Flashcards before purchasing Sankalp Pro Pass.",
            "7-Day Refund Assurance: If you face a technical issue or accidental duplicate charge, or request a cancellation within 7 days of purchasing Sankalp Pro Pass (provided fewer than 3 Pro full-length mocks have been submitted), email billing@mockexamonline.com with your Razorpay Order ID for a 100% refund to your original payment method within 5–7 business days.",
          ],
        },
      };
      const page = legalContent[cleanPath]!;
      return (
        <div className="max-w-3xl mx-auto px-4 py-14 space-y-6">
          <h1 className="text-3xl font-extrabold text-slate-900">{page.title}</h1>
          <div className="rounded-3xl bg-white border border-slate-200 p-8 space-y-4 text-sm sm:text-base text-slate-700 leading-relaxed">
            {page.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      );
    }

    // G. Flagship Conversion Homepage (/)
    const sampleQ = homeData?.sampleQuestion;

    return (
      <div>
        {/* 1. Hero Conversion Section + Flow/Pomelli Cinema & Live Cockpit Simulator */}
        <section className="relative overflow-hidden bg-gradient-to-b from-slate-950 via-[#112255] to-[#1E3A8A] text-white pt-10 pb-16 lg:py-20 px-4 lg:px-8">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Left Copy & Free/Paid CTAs */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3.5 py-1.5 text-xs font-bold text-amber-300">
                <Award className="w-4 h-4" />
                <span>
                  {lang === "HI"
                    ? "85+ आधिकारिक UPPSC पेपर्स • 2,118+ सत्यापित प्रश्न • शुद्ध एकल-भाषा"
                    : "85+ Official UPPSC Papers • 2,118+ Verified PYQs • Zero Bilingual Clutter"}
                </span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-extrabold leading-[1.12] tracking-tight">
                {lang === "HI" ? (
                  <>
                    UPPCS एवं RO/ARO कटऑफ पार करें —{" "}
                    <span className="text-amber-300">वैज्ञानिक 50-50 एलिमिनेशन</span> और सक्रिय स्मरण के साथ
                  </>
                ) : (
                  <>
                    Crack UPPCS & RO/ARO Cutoff With{" "}
                    <span className="text-amber-300">50-50 Elimination</span> & Mistake-Driven Recall
                  </>
                )}
              </h1>

              <p className="text-sm sm:text-base text-indigo-100 leading-relaxed max-w-xl">
                {lang === "HI"
                  ? "केवल अपनी चुनी हुई भाषा (शुद्ध हिन्दी या English) में प्रश्न हल करें, +1.33 / -0.44 अंकन में अपने 50-50 तुक्कों का शुद्ध लाभ मापें, और गलत प्रश्नों को स्वचालित फ्लैशकार्ड्स में बदलें।"
                  : "Read purely in your chosen medium (English or Hindi — never messy dual-language walls), audit your exact +1.33 / -0.44 guesswork gain, and turn every wrong answer into spaced-repetition flashcards."}
              </p>

              {/* Explicit Free vs Paid Primary CTAs */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 pt-1">
                <button
                  type="button"
                  onClick={() => onEnterFreeApp()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold px-6 py-4 text-sm shadow-lg transition cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {lang === "HI"
                      ? "निःशुल्क प्रैक्टिस शुरू करें (₹0)"
                      : "Start Free Version (₹0 Forever)"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onOpenProCheckout}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/25 text-white font-bold px-6 py-4 text-sm transition cursor-pointer"
                >
                  <Crown className="w-4 h-4 text-amber-300" />
                  <span>
                    {lang === "HI"
                      ? "प्रो पास चुनें (₹499/वर्ष)"
                      : "Get Pro Pass (₹499/yr)"}
                  </span>
                </button>
              </div>

              {/* Trust Telemetry Strip */}
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/15">
                <div>
                  <div className="font-mono-metric text-xl sm:text-2xl font-extrabold text-white">
                    {homeData?.stats.totalQuestions.toLocaleString() || "2,118"}+
                  </div>
                  <div className="text-[11px] text-indigo-200">
                    {lang === "HI" ? "आयोग सत्यापित प्रश्न" : "Official-Key PYQs"}
                  </div>
                </div>
                <div>
                  <div className="font-mono-metric text-xl sm:text-2xl font-extrabold text-emerald-300">
                    1,293
                  </div>
                  <div className="text-[11px] text-indigo-200">
                    {lang === "HI" ? "अर्थव्यवस्था विशेष प्रश्न" : "Indian Economy MCQs"}
                  </div>
                </div>
                <div>
                  <div className="font-mono-metric text-xl sm:text-2xl font-extrabold text-amber-300">
                    4 Exams
                  </div>
                  <div className="text-[11px] text-indigo-200">
                    UPPCS • RO/ARO • BEO • CSE
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Live UPPSC Cockpit Try-Out + Flow/Pomelli Video Frame */}
            <div className="lg:col-span-6">
              <div className="rounded-3xl bg-white text-slate-900 shadow-2xl border border-white/20 overflow-hidden">
                <div className="bg-slate-900 px-4 py-3 flex items-center justify-between gap-2 border-b border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="ml-2 text-[11px] font-bold text-slate-300">
                      {lang === "HI" ? "लाइव कॉकपिट डेमो" : "Try Live 50-50 Cockpit"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setHeroShowcaseTab("SIMULATOR")}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
                        heroShowcaseTab === "SIMULATOR"
                          ? "bg-[#1E3A8A] text-white"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      Interactive Question
                    </button>
                    <button
                      type="button"
                      onClick={() => setHeroShowcaseTab("FLOW_VIDEO")}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
                        heroShowcaseTab === "FLOW_VIDEO"
                          ? "bg-[#1E3A8A] text-white"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      <Film className="w-3 h-3" />
                      Story Reel
                    </button>
                  </div>
                </div>

                {heroShowcaseTab === "FLOW_VIDEO" ? (
                  <div className="p-6 bg-slate-950 text-white min-h-[340px] flex flex-col items-center justify-center text-center space-y-4">
                    {flowVideoAvailable ? (
                      <video
                        src="/media/flow-hero.mp4"
                        poster="/media/flow-hero-poster.webp"
                        autoPlay
                        muted
                        loop
                        playsInline
                        controls
                        onError={() => setFlowVideoAvailable(false)}
                        className="w-full rounded-2xl border border-slate-800 max-h-[320px] object-cover"
                      />
                    ) : (
                      <div className="max-w-md space-y-3 py-8">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center mx-auto">
                          <Film className="w-6 h-6 text-amber-300" />
                        </div>
                        <h3 className="font-extrabold text-base">
                          Flow & Pomelli Cinema Showcase Slot Ready
                        </h3>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          Drop your exported Google Flow video at{" "}
                          <code className="text-amber-300">public/media/flow-hero.mp4</code> and
                          Pomelli visuals into <code className="text-amber-300">public/media/</code>{" "}
                          — this player renders your brand film automatically!
                        </p>
                        <button
                          type="button"
                          onClick={() => setHeroShowcaseTab("SIMULATOR")}
                          className="rounded-xl bg-amber-400 text-slate-950 font-bold px-4 py-2 text-xs cursor-pointer"
                        >
                          Try Interactive PYQ Simulator →
                        </button>
                      </div>
                    )}
                  </div>
                ) : sampleQ ? (
                  <div className="p-5 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-[#1E3A8A]">
                        {sampleQ.subject} • Official UPPSC PYQ
                      </span>
                      <span className="font-mono-metric text-slate-500">+1.33 / -0.44</span>
                    </div>

                    <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                      {sampleQ.stem}
                    </p>

                    <div className="space-y-2">
                      {sampleQ.options.map((opt) => {
                        const isElim = demoEliminated.includes(opt.key);
                        const isPicked = demoSelected === opt.key;
                        const isRight = demoSelected && opt.key === sampleQ.correctOption;
                        const isWrong =
                          demoSelected && isPicked && opt.key !== sampleQ.correctOption;

                        return (
                          <div
                            key={opt.key}
                            onClick={() => !isElim && setDemoSelected(opt.key)}
                            className={`rounded-xl border-2 p-3 flex items-center justify-between gap-2 text-xs font-medium transition cursor-pointer ${
                              isRight
                                ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                                : isWrong
                                  ? "border-rose-500 bg-rose-50 text-rose-950"
                                  : isElim
                                    ? "border-slate-100 bg-slate-50 opacity-50 line-through"
                                    : "border-slate-200 hover:border-[#1E3A8A]"
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-mono-metric w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center font-bold text-slate-800 shrink-0">
                                {opt.key}
                              </span>
                              <span>{opt.text}</span>
                            </div>
                            {!demoSelected ? (
                              <button
                                type="button"
                                title="Strike out wrong option (50-50)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDemoEliminate(opt.key);
                                }}
                                className="p-1 rounded hover:bg-amber-100 text-slate-400 hover:text-amber-900 cursor-pointer"
                              >
                                <Scissors className="w-3.5 h-3.5" />
                              </button>
                            ) : isRight ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : isWrong ? (
                              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {demoSelected ? (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 space-y-1.5 text-xs">
                        <div className="font-extrabold text-amber-950 flex items-center justify-between">
                          <span>
                            {demoSelected === sampleQ.correctOption
                              ? "✓ Correct (+1.33 Marks)!"
                              : `✗ Commission Answer: (${sampleQ.correctOption})`}
                          </span>
                          <button
                            type="button"
                            onClick={() => onEnterFreeApp()}
                            className="text-[#1E3A8A] underline font-bold cursor-pointer"
                          >
                            Continue Full Drill →
                          </button>
                        </div>
                        {sampleQ.goldenRule && (
                          <p className="text-amber-900 font-medium">{sampleQ.goldenRule}</p>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>
                          💡 Click <Scissors className="w-3 h-3 inline" /> to eliminate 2 wrong
                          options, then click an answer!
                        </span>
                        <span className="font-bold text-[#1E3A8A]">Live Demo</span>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* 2. Why Toppers Switch to Sankalp (Pomelli Visual Campaign Ready Cards) */}
        <section className="py-16 px-4 lg:px-8 max-w-7xl mx-auto space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              {lang === "HI"
                ? "साधारण टेस्ट सीरीज़ से 3 गुना तेज़ स्कोर सुधार क्यों?"
                : "Engineered Specifically for UPPSC & Civil Services Precision"}
            </h2>
            <p className="text-sm text-slate-600">
              Every tool inside Sankalp closes the exact gap between 82 marks and clearing the 92+ Prelims cutoff.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Globe2,
                badge: "Zero Clutter Medium",
                title:
                  lang === "HI"
                    ? "100% शुद्ध हिन्दी या शुद्ध English अनुभव"
                    : "Pure English or Pure Hindi — Never Mixed",
                desc:
                  lang === "HI"
                    ? "दोनों भाषाओं की भीड़ से मुक्ति। एक क्लिक में अपनी परीक्षा माध्यम भाषा चुनें।"
                    : "Eliminate eye-fatigue from dual-language walls. Toggle your preferred medium anytime in 1 click.",
              },
              {
                icon: TrendingUp,
                badge: "+1.33 / -0.44 Math",
                title:
                  lang === "HI"
                    ? "50-50 एलिमिनेशन शुद्ध लाभ ऑडिट"
                    : "50-50 Elimination ROI Calibration",
                desc:
                  lang === "HI"
                    ? "जानें कि आपके 50-50 प्रयासों ने कितने शुद्ध अंक जोड़े और अंधे तुक्कों ने कितने काटे।"
                    : "Measure exact net marks gained from 2-option eliminations versus marks lost to wild guesses.",
              },
              {
                icon: Layers,
                badge: "Auto Mistake SRS",
                title:
                  lang === "HI"
                    ? "गलत प्रश्न → चीट शीट → FSRS फ्लैशकार्ड"
                    : "Mistake → 3-Min Cheat Sheet → FSRS Deck",
                desc:
                  lang === "HI"
                    ? "हर गलत उत्तर स्वतः आपके स्पेस्ड-रिपीटिशन डेक में जुड़ जाता है ताकि परीक्षा तक याद रहे।"
                    : "Wrong answers automatically schedule active-recall flashcards right before your forgetting curve drops.",
              },
            ].map((card, idx) => {
              const Icon = card.icon;
              return (
                <div
                  key={idx}
                  className="rounded-3xl bg-white border border-slate-200 p-7 space-y-3 shadow-xs"
                >
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-[#1E3A8A] flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="inline-block text-[11px] font-extrabold uppercase tracking-wider text-[#1E3A8A]">
                    {card.badge}
                  </span>
                  <h3 className="text-lg font-extrabold text-slate-900">{card.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{card.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. Dedicated Exam Silo Cards (Internal SEO Links to /exams/*) */}
        <section className="py-12 bg-white border-y border-slate-200 px-4 lg:px-8">
          <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {lang === "HI"
                    ? "प्रत्येक परीक्षा हेतु स्वतंत्र लर्निंग जर्नी"
                    : "Separate Adaptive Journeys for Every Target Exam"}
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Prepare for multiple exams simultaneously with exam-specific cutoff predictions and a Global Expertise Radar.
                </p>
              </div>
              <a
                href="/pyq-bank"
                onClick={(e) => handleLinkClick(e, "/pyq-bank")}
                className="text-xs font-extrabold text-[#1E3A8A] hover:underline inline-flex items-center gap-1"
              >
                Explore 2,118+ Subject PYQ Bank <ChevronRight className="w-4 h-4" />
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {(homeData?.exams || []).map((ex) => (
                <a
                  key={ex.id}
                  href={`/exams/${ex.slug}`}
                  onClick={(e) => handleLinkClick(e, `/exams/${ex.slug}`)}
                  className="rounded-2xl border border-slate-200 hover:border-[#1E3A8A] bg-[#F8FAFC] p-5 flex flex-col justify-between space-y-4 transition"
                >
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-[#1E3A8A]">
                      {ex.targetCycleLabel}
                    </span>
                    <h3 className="font-extrabold text-base text-slate-900">{ex.shortName}</h3>
                    <p className="text-xs text-slate-600 line-clamp-2">{ex.description}</p>
                  </div>
                  <div className="pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs font-mono-metric">
                    <span className="text-slate-700 font-bold">
                      +{ex.positiveMarks} / -{ex.negativeMarks}
                    </span>
                    <span className="text-[#1E3A8A] font-sans font-extrabold">
                      Open Track →
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* 4. Freemium vs Paid Selection Section */}
        {renderFreemiumPricingSection()}

        {/* 5. Daily Current Affairs & Strategy Blog Hub Preview (SEO Content Freshness Engine) */}
        <section className="py-14 bg-white border-t border-slate-200 px-4 lg:px-8">
          <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-700 mb-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Daily Updated Knowledge Engine
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {lang === "HI"
                    ? "नवीनतम करेंट अफेयर्स एवं UPPCS रणनीति ब्लॉग"
                    : "Latest UPPSC Current Affairs & Preparation Guides"}
                </h2>
              </div>
              <div className="flex items-center gap-4 text-xs font-extrabold">
                <a
                  href="/current-affairs"
                  onClick={(e) => handleLinkClick(e, "/current-affairs")}
                  className="text-[#1E3A8A] hover:underline"
                >
                  All Current Affairs →
                </a>
                <a
                  href="/blog"
                  onClick={(e) => handleLinkClick(e, "/blog")}
                  className="text-[#1E3A8A] hover:underline"
                >
                  Strategy Blog →
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(homeData?.latestPosts || []).slice(0, 6).map((post) => {
                const url =
                  post.category === "CURRENT_AFFAIRS"
                    ? `/current-affairs/${post.slug}`
                    : `/blog/${post.slug}`;
                return (
                  <a
                    key={post.id}
                    href={url}
                    onClick={(e) => handleLinkClick(e, url)}
                    className="rounded-2xl border border-slate-200 hover:border-[#1E3A8A] p-5 flex flex-col justify-between space-y-3 transition bg-[#F8FAFC]"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`font-extrabold px-2.5 py-0.5 rounded-full ${
                            post.category === "CURRENT_AFFAIRS"
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-indigo-100 text-[#1E3A8A]"
                          }`}
                        >
                          {post.category === "CURRENT_AFFAIRS" ? "CURRENT AFFAIRS" : "STRATEGY BLOG"}
                        </span>
                        <span className="text-slate-500">{post.readingTimeMins}m read</span>
                      </div>
                      <h3 className="font-bold text-sm text-slate-900 leading-snug">
                        {post.title}
                      </h3>
                      <p className="text-xs text-slate-600 line-clamp-2">{post.summary}</p>
                    </div>
                    <span className="text-xs font-extrabold text-[#1E3A8A]">Read Article →</span>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className={`min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Sticky Public Marketing Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between gap-3">
          <a
            href="/"
            onClick={(e) => handleLinkClick(e, "/")}
            className="flex items-center gap-2.5 shrink-0"
          >
            <div className="w-9 h-9 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center shadow-xs">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <div className="font-extrabold text-base leading-none text-slate-900">
                Sankalp
              </div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                MockExamOnline.com
              </div>
            </div>
          </a>

          {/* Crawlable SEO Primary Navigation */}
          <nav className="hidden lg:flex items-center gap-5 text-xs font-bold text-slate-700">
            <a
              href="/exams/uppcs-prelims"
              onClick={(e) => handleLinkClick(e, "/exams/uppcs-prelims")}
              className="hover:text-[#1E3A8A]"
            >
              UPPCS Prelims
            </a>
            <a
              href="/exams/uppsc-ro-aro"
              onClick={(e) => handleLinkClick(e, "/exams/uppsc-ro-aro")}
              className="hover:text-[#1E3A8A]"
            >
              RO / ARO
            </a>
            <a
              href="/current-affairs"
              onClick={(e) => handleLinkClick(e, "/current-affairs")}
              className="hover:text-[#1E3A8A] inline-flex items-center gap-1"
            >
              <Flame className="w-3.5 h-3.5 text-emerald-600" />
              {lang === "HI" ? "दैनिक करेंट अफेयर्स" : "Current Affairs"}
            </a>
            <a
              href="/blog"
              onClick={(e) => handleLinkClick(e, "/blog")}
              className="hover:text-[#1E3A8A]"
            >
              {lang === "HI" ? "रणनीति ब्लॉग" : "Blog"}
            </a>
            <a
              href="/pyq-bank"
              onClick={(e) => handleLinkClick(e, "/pyq-bank")}
              className="hover:text-[#1E3A8A]"
            >
              {lang === "HI" ? "PYQ प्रश्न बैंक" : "PYQ Bank"}
            </a>
            <a
              href="/pricing"
              onClick={(e) => handleLinkClick(e, "/pricing")}
              className="hover:text-[#1E3A8A]"
            >
              {lang === "HI" ? "फ्री बनाम प्रो" : "Pricing"}
            </a>
          </nav>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleLanguage}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-[#1E3A8A] whitespace-nowrap cursor-pointer"
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{lang === "HI" ? "हिन्दी" : "EN"}</span>
            </button>

            <button
              type="button"
              onClick={onOpenAuthModal}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 whitespace-nowrap cursor-pointer"
            >
              <UserCircle2 className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span>
                {fbUser
                  ? fbUser.displayName?.split(" ")[0] || "Account"
                  : lang === "HI"
                    ? "लॉगिन"
                    : "Sign In"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onEnterFreeApp()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-extrabold px-3.5 py-1.5 text-xs whitespace-nowrap shadow-xs cursor-pointer"
            >
              <span>{lang === "HI" ? "ऐप खोलें →" : "Open App →"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Route Body */}
      <div className="flex-1">{renderRouteBody()}</div>

      {/* Comprehensive SEO & Razorpay KYC Footer */}
      <footer className="bg-slate-950 text-slate-300 border-t border-slate-800 py-12 px-4 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-xs">
          <div className="col-span-2 md:col-span-1 space-y-3">
            <div className="flex items-center gap-2 text-white font-extrabold text-base">
              <GraduationCap className="w-5 h-5 text-amber-400" />
              <span>Sankalp • MockExamOnline</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Adaptive UPPSC & Civil Services Learning Engine with 2,118+ official-key verified PYQs, single-language precision, and spaced repetition.
            </p>
            <div className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Razorpay Secured • 100% SSL</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="font-extrabold text-white uppercase tracking-wider">Exam Tracks</div>
            <ul className="space-y-2">
              <li>
                <a href="/exams/uppcs-prelims" onClick={(e) => handleLinkClick(e, "/exams/uppcs-prelims")} className="hover:text-white">
                  UPPCS Prelims Mock Test 2026
                </a>
              </li>
              <li>
                <a href="/exams/uppsc-ro-aro" onClick={(e) => handleLinkClick(e, "/exams/uppsc-ro-aro")} className="hover:text-white">
                  UPPSC RO/ARO Test Series
                </a>
              </li>
              <li>
                <a href="/exams/uppsc-beo" onClick={(e) => handleLinkClick(e, "/exams/uppsc-beo")} className="hover:text-white">
                  UPPSC BEO Practice Papers
                </a>
              </li>
              <li>
                <a href="/exams/upsc-cse" onClick={(e) => handleLinkClick(e, "/exams/upsc-cse")} className="hover:text-white">
                  UPSC CSE GS Prelims
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <div className="font-extrabold text-white uppercase tracking-wider">SEO Study Hub</div>
            <ul className="space-y-2">
              <li>
                <a href="/current-affairs" onClick={(e) => handleLinkClick(e, "/current-affairs")} className="hover:text-white">
                  Daily Current Affairs (EN/HI)
                </a>
              </li>
              <li>
                <a href="/blog" onClick={(e) => handleLinkClick(e, "/blog")} className="hover:text-white">
                  Preparation Strategy Blog
                </a>
              </li>
              <li>
                <a href="/pyq-bank" onClick={(e) => handleLinkClick(e, "/pyq-bank")} className="hover:text-white">
                  Verified PYQ Bank (2,118+)
                </a>
              </li>
              <li>
                <a href="/pricing" onClick={(e) => handleLinkClick(e, "/pricing")} className="hover:text-white">
                  Free vs Pro Pass Pricing
                </a>
              </li>
              <li>
                <a href="/sitemap.xml" className="hover:text-white">
                  XML Sitemap
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <div className="font-extrabold text-white uppercase tracking-wider">Company & Policies</div>
            <ul className="space-y-2">
              <li>
                <a href="/about" onClick={(e) => handleLinkClick(e, "/about")} className="hover:text-white">
                  About Us
                </a>
              </li>
              <li>
                <a href="/contact" onClick={(e) => handleLinkClick(e, "/contact")} className="hover:text-white">
                  Contact Support
                </a>
              </li>
              <li>
                <a href="/privacy-policy" onClick={(e) => handleLinkClick(e, "/privacy-policy")} className="hover:text-white">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="/terms" onClick={(e) => handleLinkClick(e, "/terms")} className="hover:text-white">
                  Terms & Conditions
                </a>
              </li>
              <li>
                <a href="/refund-policy" onClick={(e) => handleLinkClick(e, "/refund-policy")} className="hover:text-white">
                  Cancellation & Refund Policy
                </a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
};
