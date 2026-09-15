"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../../app-shell";
import { getAccessToken, refreshAccessToken } from "../../../auth-client";
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
  theme: { color: string };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

function loadRazorpay() {
  return new Promise<boolean>((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay]");
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpay = "true";
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function PayPage() {
  const { purchaseId } = useParams<{ purchaseId: string }>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function initiate() {
    setMessage("");
    setError(false);
    setLoading(true);
    try {
      const token = getAccessToken() ?? await refreshAccessToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/payments/initiate`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            authorization: `Bearer ${token ?? ""}`,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ purchaseId }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(true);
        setMessage(body.message ?? body.error ?? `Payment initiation failed (${response.status}).`);
        return;
      }

      const payment = body.data?.payment;
      const ready = await loadRazorpay();
      if (!ready || !window.Razorpay) {
        setError(true);
        setMessage("Razorpay Checkout could not be loaded. Check your connection and try again.");
        return;
      }
      if (!payment?.razorpayKeyId) {
        setError(true);
        setMessage("Payment provider is not configured with a public Checkout key.");
        return;
      }

      const checkout = new window.Razorpay({
        key: payment.razorpayKeyId,
        amount: Math.round(Number(payment.amount) * 100),
        currency: payment.currency,
        name: "MetroFlow",
        description: "MetroFlow journey ticket",
        order_id: payment.razorpayOrderId,
        handler: (result) => {
          setError(false);
          void confirmPayment(result);
        },
        modal: {
          ondismiss: () => setMessage("Payment window closed. Your payment was not confirmed."),
        },
        theme: { color: "#1769e0" },
      });
      checkout.open();
    } catch (caught) {
      setError(true);
      setMessage(caught instanceof Error ? caught.message : "Payment service is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmPayment(result: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) {
    const token = getAccessToken() ?? await refreshAccessToken();
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/payments/confirm`, {
      method: "POST", credentials: "include", headers: { authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" },
      body: JSON.stringify({ razorpayOrderId: result.razorpay_order_id, razorpayPaymentId: result.razorpay_payment_id, razorpaySignature: result.razorpay_signature }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(true); setMessage(body.message ?? "Payment confirmation failed. Please wait for webhook confirmation."); return; }
    setError(false);
    const ticketId = body.data?.ticket?.id;
    if (ticketId) window.location.assign(`/tickets/${ticketId}`);
    else setMessage("Payment confirmed successfully. Your ticket is being issued.");
  }

  return (
    <AppShell eyebrow="Payment">
      <h1 className="page-title">Complete payment</h1>
      <p className="subtle page-description">Review your purchase and pay securely using Razorpay Test Mode.</p>
      <div className="dashboard-panel light-panel">
        <div>
          <h2>Purchase ready</h2>
          <p className="subtle">Purchase ID: {purchaseId}</p>
          {message && <div className={`feedback ${error ? "error" : "success"}`}>{message}</div>}
        </div>
        <button className="primary dashboard-cta" onClick={initiate} disabled={loading}>
          {loading ? "Opening payment..." : "Open Razorpay Checkout"}
        </button>
      </div>
    </AppShell>
  );
}
