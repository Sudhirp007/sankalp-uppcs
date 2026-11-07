import React, { useEffect, useState } from "react";
import { Check, ShieldCheck, Sparkles, X, CreditCard, Lock } from "lucide-react";
import { api, type SubscriptionPlanDTO } from "../lib/api";
import type { LangCode } from "../lib/i18n";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

interface UpgradeModalProps {
  lang: LangCode;
  userEmail: string | null;
  userName: string;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  lang,
  userEmail,
  userName,
  onClose,
  onSuccess,
}) => {
  const [plans, setPlans] = useState<SubscriptionPlanDTO[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("plan-sankalp-pro-annual");
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .getBillingPlans()
      .then((res) => {
        setPlans(res.plans);
        if (res.plans.length > 0 && !res.plans.some((p) => p.id === selectedPlanId)) {
          setSelectedPlanId(res.plans[0]!.id);
        }
      })
      .catch((err) => setErrorMsg(err.message))
      .finally(() => setLoadingPlans(false));
  }, []);

  const handleCheckout = async () => {
    setProcessing(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const order = await api.createBillingOrder(selectedPlanId);

      // 1. Live / Test Razorpay Checkout.js modal when real RAZORPAY_KEY_ID is set
      if (!order.isSandbox && window.Razorpay) {
        const rzp = new window.Razorpay({
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: "Sankalp UPPSC",
          description: order.planName,
          order_id: order.orderId,
          prefill: {
            name: userName,
            email: userEmail || "aspirant@sankalp.in",
          },
          theme: { color: "#1E3A8A" },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            await api.verifyBillingPayment({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            await onSuccess();
            onClose();
          },
        });
        rzp.open();
        setProcessing(false);
        return;
      }

      // 2. Sandbox Preview Mode: Verify real HMAC-SHA256 signature on Cloudflare Worker & upgrade account
      if (order.sandboxProof) {
        setStatusMsg(
          lang === "HI"
            ? "रेज़रपे सैंडबॉक्स HMAC-SHA256 हस्ताक्षर सत्यापित किया जा रहा है..."
            : "Verifying Razorpay Order & Web Crypto HMAC-SHA256 Signature..."
        );
        await api.verifyBillingPayment(order.sandboxProof);
        await onSuccess();
        onClose();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Payment verification failed");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-[#1E3A8A] via-indigo-900 to-slate-900 px-6 py-5 text-white flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 text-amber-200 px-3 py-0.5 text-xs font-semibold mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              Sankalp Pro Pass • Razorpay Secured
            </div>
            <h2 className="text-xl font-bold">
              {lang === "HI"
                ? "असीमित पूर्ण-लंबाई मॉक टेस्ट एवं क्रॉस-एग्जाम एनालिटिक्स अनलॉक करें"
                : "Unlock Unlimited Full-Length Commission Mocks & Mistake SRS"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loadingPlans ? (
            <div className="py-10 text-center text-sm text-slate-500">Loading subscription plans...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plans.map((plan) => {
                const active = selectedPlanId === plan.id;
                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`cursor-pointer rounded-xl border-2 p-4 transition flex flex-col justify-between ${
                      active
                        ? "border-[#1E3A8A] bg-indigo-50/50 shadow-sm"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-100 text-[#1E3A8A]">
                          {plan.badge}
                        </span>
                        <span className="text-xs text-slate-500">
                          {plan.validityDays} {lang === "HI" ? "दिन" : "Days"}
                        </span>
                      </div>
                      <h3 className="font-bold text-base text-slate-900">{plan.name}</h3>
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="font-mono-metric text-3xl font-extrabold text-slate-900">
                          ₹{plan.amountInr}
                        </span>
                        <span className="text-xs text-slate-500">incl. GST</span>
                      </div>

                      <ul className="mt-4 space-y-2">
                        {plan.features.map((feat, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                            <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {statusMsg && (
            <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-4 py-2.5 text-xs text-indigo-900 font-medium">
              {statusMsg}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs text-rose-700 font-medium">
              {errorMsg}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>UPI, GPay, PhonePe, Cards & NetBanking via Razorpay HMAC-SHA256</span>
            </div>
            <button
              type="button"
              disabled={processing || loadingPlans}
              onClick={handleCheckout}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-semibold px-5 py-2.5 text-sm shadow-sm transition disabled:opacity-60 cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              {processing
                ? lang === "HI"
                  ? "भुगतान सत्यापित हो रहा है..."
                  : "Processing Razorpay Order..."
                : lang === "HI"
                  ? "सुरक्षित भुगतान करें (Razorpay)"
                  : "Pay Securely with Razorpay"}
              <Lock className="w-3.5 h-3.5 opacity-80" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
