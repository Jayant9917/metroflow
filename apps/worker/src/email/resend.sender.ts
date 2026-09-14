export async function sendEmail(event: {
  type: string;
  email: string;
  codeOrToken: string;
  expiresInMinutes: number;
  url?: string;
}) {
  const subject =
    event.type === "otp.requested"
      ? "Your MetroFlow login code"
      : "Reset your MetroFlow password";
  const isOtp = event.type === "otp.requested";
  const content = isOtp
    ? `<p>Your login code is:</p><div style="padding:18px;background:#fff;border-radius:12px;word-break:break-all;color:#1769e0;font-size:34px;font-weight:bold;letter-spacing:8px;text-align:center">${event.codeOrToken}</div>`
    : `<p>Click below to choose a new password.</p><p><a href="${event.url}" style="display:inline-block;padding:14px 22px;background:#1769e0;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Reset password</a></p>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [event.email],
      subject,
      html: `<div style="font-family:Arial;max-width:560px;margin:32px auto;padding:32px;background:#f3f7fc;color:#10233f"><h1 style="color:#1769e0">MetroFlow</h1>${content}<p>Expires in ${event.expiresInMinutes} minutes.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error(`Resend failed: ${response.status}`);
}
