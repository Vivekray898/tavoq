import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Taskora <noreply@taskora.app>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail({ to, subject, html }: SendEmailOptions) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not configured. Skipping email.");
    return null;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error("Email send error:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Email send failed:", error);
    return null;
  }
}

// ──────────────────────────────────────────────
// Email Templates
// ──────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseTemplate(title: string, content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:white;border-radius:8px;padding:32px;margin-top:20px;">
          <h1 style="font-size:20px;font-weight:600;color:#171717;margin:0 0 20px;">
            ${title}
          </h1>
          <div style="color:#525252;font-size:14px;line-height:1.6;">
            ${content}
          </div>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e5e5;">
            <p style="color:#a3a3a3;font-size:12px;margin:0;">
              Taskora — Agency Work Management
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ──────────────────────────────────────────────
// Notification Emails (important events only)
// ──────────────────────────────────────────────

export async function sendTaskAssignedEmail(
  to: string,
  employeeName: string,
  taskTitle: string,
  projectName: string,
  clientName: string,
  deadline: string | null,
  payoutAmount: number
) {
  const safeName = escapeHtml(employeeName);
  const safeTitle = escapeHtml(taskTitle);
  const safeProject = escapeHtml(projectName);
  const safeClient = escapeHtml(clientName);

  const deadlineStr = deadline
    ? new Date(deadline).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "No deadline set";

  const content = `
    <p>Hi ${safeName},</p>
    <p>You have been assigned a new task:</p>
    <div style="background:#f9f9f9;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="font-weight:600;margin:0 0 8px;">${safeTitle}</p>
      ${safeClient ? `<p style="margin:0 0 4px;color:#737373;"><strong>Client:</strong> ${safeClient}</p>` : ""}
      ${safeProject ? `<p style="margin:0 0 4px;color:#737373;"><strong>Project:</strong> ${safeProject}</p>` : ""}
      <p style="margin:0 0 4px;color:#737373;"><strong>Deadline:</strong> ${deadlineStr}</p>
      ${payoutAmount > 0 ? `<p style="margin:0;color:#737373;"><strong>Payout:</strong> ₹${payoutAmount.toLocaleString("en-IN")}</p>` : ""}
    </div>
    <p>
      <a href="${APP_URL}/tasks" style="display:inline-block;background:#171717;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500;">
        View Task
      </a>
    </p>
  `;

  return sendEmail({
    to,
    subject: `New task assigned — ${taskTitle}`,
    html: baseTemplate("New Task Assigned", content),
  });
}

export async function sendRevisionRequestedEmail(
  to: string,
  employeeName: string,
  taskTitle: string,
  comment?: string
) {
  const safeName = escapeHtml(employeeName);
  const safeTitle = escapeHtml(taskTitle);
  const safeComment = comment ? escapeHtml(comment) : "";

  const content = `
    <p>Hi ${safeName},</p>
    <p>Your task <strong>${safeTitle}</strong> has been sent back for revision.</p>
    ${safeComment ? `<p style="background:#fff7ed;border-left:3px solid #f97316;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0;"><em>${safeComment}</em></p>` : ""}
    <p>Please make the requested changes and resubmit.</p>
    <p>
      <a href="${APP_URL}/tasks" style="display:inline-block;background:#171717;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500;">
        View Task
      </a>
    </p>
  `;

  return sendEmail({
    to,
    subject: `Revision requested — ${taskTitle}`,
    html: baseTemplate("Revision Requested", content),
  });
}

export async function sendTaskApprovedEmail(
  to: string,
  employeeName: string,
  taskTitle: string
) {
  const safeName = escapeHtml(employeeName);
  const safeTitle = escapeHtml(taskTitle);

  const content = `
    <p>Hi ${safeName},</p>
    <p>Your task <strong>${safeTitle}</strong> has been approved! 🎉</p>
    <p>Great work!</p>
  `;

  return sendEmail({
    to,
    subject: `Task approved — ${taskTitle}`,
    html: baseTemplate("Task Approved", content),
  });
}

export async function sendPaymentPaidEmail(
  to: string,
  employeeName: string,
  taskTitle: string,
  amount: number,
  paymentNote?: string
) {
  const safeName = escapeHtml(employeeName);
  const safeTitle = escapeHtml(taskTitle);
  const safeNote = paymentNote ? escapeHtml(paymentNote) : "";

  const content = `
    <p>Hi ${safeName},</p>
    <p>A payment has been recorded for your task:</p>
    <div style="background:#f0fdf4;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="font-weight:600;margin:0 0 8px;">${safeTitle}</p>
      <p style="margin:0 0 4px;color:#737373;"><strong>Amount:</strong> ₹${amount.toLocaleString("en-IN")}</p>
      ${safeNote ? `<p style="margin:0;color:#737373;"><strong>Note:</strong> ${safeNote}</p>` : ""}
    </div>
  `;

  return sendEmail({
    to,
    subject: `Payment recorded — ₹${amount.toLocaleString("en-IN")}`,
    html: baseTemplate("Payment Recorded", content),
  });
}
