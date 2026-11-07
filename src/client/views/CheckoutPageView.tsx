import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  Globe2,
  GraduationCap,
  Lock,
  Phone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, type SubscriptionPlanDTO } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface CheckoutPageViewProps {
  lang: LangCode;
  userEmail: string | null;
  initialDisplayName: string;
  initialPhoneNumber: string | null;
  currentPlanTier: "FREE" | "PRO_PASS";
  isTestBillingMode?: boolean;
  onToggleLanguage: () => Promise<void>;
  onNavigateHome: () => void;
  onPaymentSuccess: () => Promise<void>;
  onResetPlanSuccess: () => Promise<void>;
}

export const CheckoutPageView: React.FC<CheckoutPageViewProps> = ({
  lang,
  userEmail,
  initialDisplayName,
  initialPhoneNumber,
  currentPlanTier,
  isTestBillingMode = true,
  onToggleLanguage,
  onNavigateHome,
  onPaymentSuccess,
  onResetPlanSuccess,
}) => {
  const [plans, setPlans] = useState<SubscriptionPlanDTO[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("plan") || "plan-sankalp-pro-annual";
  });
  const [phoneDigits, setPhoneDigits] = useState<string>(() =>
    (initialPhoneNumber || "").replace(/^\+91/, "").replace(/[^\d]/g, "").slice(0, 10)
  );
  const [buyerName, setBuyerName] = useState<string>(() =>
    initialDisplayName === "Guest Aspirant" || initialDisplayName === "Aspirant"
      ? ""
      : initialDisplayName
  );
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .getBillingPlans()
      .then((res) => {
        setPlans(res.plans);
        const urlPlan = new URLSearchParams(window.location.search).get("plan");
        if (urlPlan && res.plans.some((p) => p.id === urlPlan)) {
          setSelectedPlanId(urlPlan);
        } else if (res.plans.length > 0 && !res.plans.some((p) => p.id === selectedPlanId)) {
          setSelectedPlanId(res.plans[0]!.id);
        }
      })
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Failed to load plans"))
      .finally(() => setLoadingPlans(false));
  }, []);

  const isPhoneValid = /^[6-9]\d{9}$/.test(phoneDigits);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0] || null;

  const handlePayNow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPhoneValid) {
      setErrorMsg(
        lang === "HI"
          ? "भुगतान शुरू करने हेतु कृपया अपना वैध 10-अंकीय मोबाइल नंबर दर्ज करें।"
          : "Please enter a valid 10-digit Indian mobile number to proceed to payment."
      );
      return;
    }

    setProcessing(true);
    setErrorMsg(null);
    setStatusMsg(null);

    const formattedPhone = `+91${phoneDigits}`;

    try {
      const order = await api.createBillingOrder(selectedPlanId, {
        phoneNumber: formattedPhone,
        displayName: buyerName.trim() || undefined,
      });

      if (!order.isSandbox && window.Razorpay) {
        if (order.keyId.startsWith("rzp_test_")) {
          setStatusMsg(
            lang === "HI"
              ? "Razorpay Test Mode सक्रिय: परीक्षण हेतु UPI में success@razorpay का उपयोग करें।"
              : "Razorpay Test Mode Active: Use UPI ID success@razorpay or any test card."
          );
        }

        const rzp = new window.Razorpay({
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: "Sankalp • MockExamOnline",
          description: order.planName,
          order_id: order.orderId,
          prefill: {
            name: buyerName.trim() || "Sankalp Aspirant",
            contact: formattedPhone,
            ...(userEmail ? { email: userEmail } : {}),
          },
          theme: { color: "#1E3A8A" },
          modal: {
            ondismiss: () => {
              setProcessing(false);
            },
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              setProcessing(true);
              setStatusMsg(
                lang === "HI"
                  ? "भुगतान सत्यापित किया जा रहा है... आपको /app सेटअप पेज पर ले जाया जा रहा है।"
                  : "Verifying Razorpay HMAC-SHA256 payment... Redirecting you to /app setup!"
              );
              await api.verifyBillingPayment({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              await onPaymentSuccess();
            } catch (verifyErr: unknown) {
              setErrorMsg(
                verifyErr instanceof Error ? verifyErr.message : "Signature verification failed"
              );
            } finally {
              setProcessing(false);
            }
          },
        });

        rzp.on?.("payment.failed", (resp) => {
          setErrorMsg(resp?.error?.description || "Razorpay payment failed. Please retry.");
          setProcessing(false);
        });

        rzp.open();
        return;
      }

      if (order.sandboxProof) {
        setStatusMsg(
          lang === "HI"
            ? "भुगतान सत्यापित किया जा रहा है... आपको /app पेज पर ले जाया जा रहा है।"
            : "Verifying order signature... Redirecting you to /app profile setup!"
        );
        await api.verifyBillingPayment(order.sandboxProof);
        await onPaymentSuccess();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unable to initiate Razorpay payment");
      setProcessing(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] ${lang === "HI" ? "lang-hi" : ""}`}>
      {/* Top Header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-3">
          <div
            onClick={onNavigateHome}
            className="flex items-center gap-2.5 cursor-pointer"
            title="Back to Home"
          >
            <div className="w-9 h-9 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center shadow-xs">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <div className="font-extrabold text-base leading-none text-slate-900">Sankalp</div>
              <div className="text-[11px] text-slate-500 font-medium mt-0.5">MockExamOnline.com</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleLanguage}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 px-3 py-1.5 text-xs font-bold text-[#1E3A8A] cursor-pointer"
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{lang === "HI" ? "हिन्दी" : "EN"}</span>
            </button>

            <button
              type="button"
              onClick={onNavigateHome}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{lang === "HI" ? "होम पेज" : "Back to Home"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Regular Checkout Page */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 lg:px-6 py-8 sm:py-10">
        <div className="mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-xs font-extrabold text-[#1E3A8A] uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "HI" ? "तुरंत प्रो पास चेकआउट" : "Express 2-Step Pro Pass Checkout"}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            {lang === "HI"
              ? "मोबाइल नंबर दर्ज करें और सुरक्षित भुगतान करें"
              : "Enter Your Mobile Number & Complete Payment"}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {lang === "HI"
              ? "भुगतान पूर्ण होते ही आपको सीधे /app पेज पर ले जाया जाएगा जहाँ आप अपना माध्यम और लक्षित परीक्षाएं चुन सकेंगे।"
              : "Once your mobile number is entered and payment completes, you will be taken straight to /app to configure your medium, target exams, and profile details."}
          </p>
        </div>

        {currentPlanTier === "PRO_PASS" && (
          <div className="mb-6 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs sm:text-sm text-emerald-950">
              <span className="font-bold">Pro Pass Active:</span>{" "}
              {lang === "HI"
                ? "इस ब्राउज़र सत्र पर प्रो पास पहले से सक्रिय है। पुनः भुगतान टेस्ट करने हेतु नीचे रीसेट करें:"
                : "Pro Pass is currently active on this session. Reset to Free Tier to test a fresh Razorpay checkout:"}
            </div>
            {isTestBillingMode && (
              <button
                type="button"
                disabled={processing}
                onClick={async () => {
                  setProcessing(true);
                  try {
                    await api.resetTestBillingPlan();
                    await onResetPlanSuccess();
                    setStatusMsg("Reset to Free Tier! Enter your mobile number below to test Razorpay.");
                  } catch (e: unknown) {
                    setErrorMsg(e instanceof Error ? e.message : "Reset failed");
                  } finally {
                    setProcessing(false);
                  }
                }}
                className="shrink-0 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-100 px-3.5 py-2 text-xs font-bold text-emerald-900 cursor-pointer"
              >
                {lang === "HI" ? "Free प्लान पर रीसेट करें" : "Reset to Free (Test Mode)"}
              </button>
            )}
          </div>
        )}

        <form onSubmit={handlePayNow} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Step 1 (Phone Number) + Step 2 (Plan Selection) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Step 1: Mobile Number First */}
            <section className="rounded-2xl bg-white border-2 border-[#1E3A8A]/20 shadow-xs p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-base font-extrabold text-slate-900">
                  <span className="w-6 h-6 rounded-full bg-[#1E3A8A] text-white text-xs flex items-center justify-center">
                    1
                  </span>
                  <span>
                    {lang === "HI"
                      ? "अपना 10-अंकीय मोबाइल नंबर दर्ज करें"
                      : "Provide Your 10-Digit Mobile Number"}
                  </span>
                </div>
                {isPhoneValid && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {lang === "HI" ? "सत्यापित प्रारूप" : "Ready to Pay"}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {lang === "HI"
                    ? "मोबाइल नंबर (भुगतान रसीद एवं प्रो पास लिंकिंग हेतु अनिवार्य) *"
                    : "Mobile Number (Required to link your Pro Pass & receipt) *"}
                </label>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-3 text-sm font-mono-metric font-extrabold text-slate-800">
                    <Phone className="w-4 h-4 text-[#1E3A8A]" />
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    required
                    autoFocus
                    maxLength={10}
                    placeholder="9876543210"
                    value={phoneDigits}
                    onChange={(e) => {
                      setErrorMsg(null);
                      setPhoneDigits(e.target.value.replace(/[^\d]/g, "").slice(0, 10));
                    }}
                    className="flex-1 rounded-xl border-2 border-slate-300 focus:border-[#1E3A8A] px-4 py-3 text-base font-mono-metric font-bold tracking-wider focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {lang === "HI"
                    ? "आपका प्रो पास इस मोबाइल नंबर से सुरक्षित रूप से जुड़ जाएगा। अन्य विवरण (माध्यम एवं परीक्षाएं) भुगतान के बाद /app पर लिए जाएंगे।"
                    : "Your Pro Pass is bound to this mobile number immediately. You will configure your medium, name, and target exams on /app right after payment."}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {lang === "HI" ? "आपका नाम (वैकल्पिक)" : "Your Name (Optional — can also be added after payment)"}
                </label>
                <input
                  type="text"
                  placeholder={lang === "HI" ? "जैसे: सुधीर पाण्डेय" : "e.g., Sudhir Pandey"}
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>
            </section>

            {/* Step 2: Select Plan */}
            <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 space-y-4">
              <div className="flex items-center gap-2 text-base font-extrabold text-slate-900">
                <span className="w-6 h-6 rounded-full bg-[#1E3A8A] text-white text-xs flex items-center justify-center">
                  2
                </span>
                <span>
                  {lang === "HI" ? "अपना प्रो प्लान चुनें" : "Select Your Subscription Plan"}
                </span>
              </div>

              {loadingPlans ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading plans...</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {plans.map((plan) => {
                    const active = selectedPlanId === plan.id;
                    return (
                      <div
                        key={plan.id}
                        onClick={() => setSelectedPlanId(plan.id)}
                        className={`cursor-pointer rounded-2xl border-2 p-4 transition flex flex-col justify-between ${
                          active
                            ? "border-[#1E3A8A] bg-indigo-50/50 shadow-xs"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-100 text-[#1E3A8A]">
                              {plan.badge}
                            </span>
                            <span className="text-xs font-semibold text-slate-500">
                              {plan.validityDays} {lang === "HI" ? "दिन" : "Days"}
                            </span>
                          </div>
                          <h3 className="font-bold text-sm text-slate-900">{plan.name}</h3>
                          <div className="mt-2 flex items-baseline gap-1">
                            <span className="font-mono-metric text-2xl font-extrabold text-slate-900">
                              ₹{plan.amountInr}
                            </span>
                            <span className="text-[11px] text-slate-500">incl. GST</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Order Summary & Pay Button */}
          <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-sm p-6 space-y-5 sticky top-24">
            <h2 className="font-extrabold text-base text-slate-900 border-b border-slate-100 pb-3">
              {lang === "HI" ? "ऑर्डर सारांश" : "Order Summary"}
            </h2>

            {selectedPlan && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-sm text-slate-900">{selectedPlan.name}</div>
                    <div className="text-xs text-slate-500">
                      {selectedPlan.validityDays} {lang === "HI" ? "दिनों की वैधता" : "Days Unlimited Access"}
                    </div>
                  </div>
                  <div className="font-mono-metric text-xl font-extrabold text-slate-900">
                    ₹{selectedPlan.amountInr}
                  </div>
                </div>

                <ul className="space-y-2 pt-2 border-t border-slate-100">
                  {selectedPlan.features.slice(0, 4).map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 flex items-center justify-between text-sm">
              <span className="font-bold text-slate-700">
                {lang === "HI" ? "कुल देय राशि (GST सहित)" : "Total Payable (incl. GST)"}
              </span>
              <span className="font-mono-metric text-2xl font-extrabold text-[#1E3A8A]">
                ₹{selectedPlan?.amountInr ?? 499}
              </span>
            </div>

            {statusMsg && (
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-3.5 py-2.5 text-xs text-indigo-900 font-medium">
                {statusMsg}
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-700 font-medium">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={!isPhoneValid || processing || loadingPlans}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-extrabold py-3.5 px-5 text-sm shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              <span>
                {processing
                  ? lang === "HI"
                    ? "भुगतान प्रोसेस हो रहा है..."
                    : "Processing Secure Payment..."
                  : !isPhoneValid
                    ? lang === "HI"
                      ? "भुगतान हेतु ऊपर 10-अंकीय मोबाइल नंबर लिखें"
                      : "Enter 10-Digit Mobile Number Above to Pay"
                    : lang === "HI"
                      ? `₹${selectedPlan?.amountInr ?? 499} का सुरक्षित भुगतान करें →`
                      : `Pay ₹${selectedPlan?.amountInr ?? 499} & Continue to /app →`}
              </span>
              <Lock className="w-3.5 h-3.5 opacity-80" />
            </button>

            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500 text-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Razorpay HMAC-SHA256 Verified • UPI, GPay, PhonePe, Cards & NetBanking</span>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
};
