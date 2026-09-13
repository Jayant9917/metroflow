"use client";
import { useEffect } from "react";
export function Toast({
  message,
  type = "error",
  onClose,
}: {
  message: string;
  type?: "error" | "success";
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return (
    <div
      className={`toast ${type}`}
      role={type === "error" ? "alert" : "status"}
    >
      <span>{type === "error" ? "!" : "✓"}</span>
      <div>{message}</div>
      <button aria-label="Dismiss notification" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
