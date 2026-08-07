import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "AC Edunity <noreply@edunity.me>";
const APP_URL = "https://edunity.me";
const TIME_ZONE = "America/Guayaquil";
const MAX_ATTEMPTS = 3;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

type ReminderType = "due_24h" | "due_1h";
type EvaluationRow = {
  id: string;
  user_id: string;
  title: string;
  evaluation_type: string;
  evaluation_date: string;
  evaluation_time: string | null;
  reminders_enabled: boolean;
  subjects: { name?: string } | { name?: string }[] | null;
};

function clean(value: unknown, max = 400) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return clean(value, 300).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function adminKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    return clean(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")?.default, 1000);
  } catch {
    return "";
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function dueAt(row: EvaluationRow) {
  const hasTime = /^\d{2}:\d{2}/.test(row.evaluation_time || "");
  const localTime = hasTime ? String(row.evaluation_time).slice(0, 5) : "23:59";
  const date = new Date(`${row.evaluation_date}T${localTime}:00-05:00`);
  return Number.isNaN(date.getTime()) ? null : { date, hasTime };
}

function reminderType(remainingMs: number, hasTime: boolean): ReminderType | null {
  const hours = remainingMs / 3_600_000;
  if (hasTime && hours >= 0 && hours <= 1) return "due_1h";
  if (hours > 1 && hours <= 24) return "due_24h";
  return null;
}

function subjectName(row: EvaluationRow) {
  if (Array.isArray(row.subjects)) return clean(row.subjects[0]?.name, 160);
  return clean(row.subjects?.name, 160);
}

function formatDue(date: Date) {
  return {
    date: new Intl.DateTimeFormat("es-EC", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date),
    time: new Intl.DateTimeFormat("es-EC", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
  };
}

function subjectLine(row: EvaluationRow, type: ReminderType) {
  const subject = subjectName(row) || "tu materia";
  return type === "due_1h"
    ? `Tu evaluación de ${subject} comienza en 1 hora — AC Edunity`
    : `Tu evaluación de ${subject} es mañana — AC Edunity`;
}

function emailHtml(row: EvaluationRow, type: ReminderType, due: Date, firstName: string) {
  const formatted = formatDue(due);
  const subject = subjectName(row);
  const greeting = firstName ? `Hola, ${escapeHtml(firstName)}.` : "Hola.";
  const remaining = type === "due_1h" ? "Aproximadamente 1 hora" : "Menos de 24 horas";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#eef2f8;font-family:Arial,Helvetica,sans-serif;color:#24314d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 36px rgba(31,45,88,.13)"><tr><td style="padding:32px;background:linear-gradient(135deg,#6554d9,#486fea 58%,#43b9e8);color:#fff"><div style="font-size:13px;font-weight:700;letter-spacing:1.4px">AC EDUNITY</div><h1 style="margin:10px 0 0;font-size:27px">Tu evaluación se acerca</h1></td></tr><tr><td style="padding:34px 40px 38px"><p style="font-size:16px;line-height:25px;color:#55627b">${greeting} Este es tu recordatorio académico.</p><div style="padding:22px;border:1px solid #dfe5f2;border-radius:16px;background:#f8f9fd"><div style="font-size:20px;font-weight:800">${escapeHtml(row.title)}</div><div style="margin-top:8px;color:#6554d9;font-weight:700">${escapeHtml(subject)}</div><p style="margin:18px 0 0;line-height:25px"><b>Tipo:</b> ${escapeHtml(row.evaluation_type)}<br><b>Fecha:</b> ${escapeHtml(formatted.date)}<br><b>Hora:</b> ${escapeHtml(formatted.time)}<br><b>Tiempo restante:</b> ${escapeHtml(remaining)}</p></div><p style="text-align:center;margin:26px 0 0"><a href="${APP_URL}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:#6554d9;color:#fff;text-decoration:none;font-weight:700">Ver mis evaluaciones</a></p></td></tr><tr><td align="center" style="padding:22px;background:#172341;color:#dce6fb;font-size:13px">AC Edunity · Gestión educativa inteligente · edunity.me</td></tr></table></td></tr></table></body></html>`;
}

async function claimDelivery(admin: ReturnType<typeof createClient>, row: EvaluationRow, type: ReminderType, due: Date) {
  const now = new Date().toISOString();
  const scheduledFor = new Date(due.getTime() - (type === "due_1h" ? 1 : 24) * 3_600_000).toISOString();
  const base = { user_id: row.user_id, evaluation_id: row.id, reminder_type: type, status: "sending", scheduled_for: scheduledFor, evaluation_due_at: due.toISOString(), attempts: 1, updated_at: now };
  const { data: inserted, error: insertError } = await admin.from("evaluation_reminder_deliveries").insert(base).select("*").single();
  if (!insertError && inserted) return { claimed: true, row: inserted };
  if (insertError?.code !== "23505") throw insertError;
  const { data: delivery, error } = await admin.from("evaluation_reminder_deliveries").select("*").eq("evaluation_id", row.id).eq("reminder_type", type).single();
  if (error || !delivery) throw error || new Error("delivery_not_found");
  if (delivery.status === "sent" || delivery.sent_at || delivery.status === "cancelled") return { claimed: false, reason: delivery.status };
  if (Number(delivery.attempts || 0) >= MAX_ATTEMPTS) return { claimed: false, reason: "max_attempts" };
  const stale = Date.now() - new Date(delivery.updated_at).getTime() >= CLAIM_TIMEOUT_MS;
  if (delivery.status === "sending" && !stale) return { claimed: false, reason: "in_progress" };
  const { data: claimed, error: claimError } = await admin.from("evaluation_reminder_deliveries").update({ status: "sending", attempts: Number(delivery.attempts || 0) + 1, last_error: null, updated_at: now, evaluation_due_at: due.toISOString(), scheduled_for: scheduledFor }).eq("id", delivery.id).eq("status", delivery.status).eq("updated_at", delivery.updated_at).select("*");
  if (claimError) throw claimError;
  return claimed?.length ? { claimed: true, row: claimed[0] } : { claimed: false, reason: "in_progress" };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = adminKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!supabaseUrl || !serviceKey || !resendKey) {
    console.error("[evaluation-reminders] Configuración incompleta", JSON.stringify({ supabase: Boolean(supabaseUrl), admin_key: Boolean(serviceKey), resend_key: Boolean(resendKey) }));
    return json({ ok: false, error: "Configuración interna incompleta" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const fromDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString().slice(0, 10);
  const throughDate = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await admin.from("evaluations").select("id,user_id,title,evaluation_type,evaluation_date,evaluation_time,reminders_enabled,subjects(name)").eq("reminders_enabled", true).gte("evaluation_date", fromDate).lte("evaluation_date", throughDate).limit(500);
  if (error) {
    console.error("[evaluation-reminders] Consulta falló", JSON.stringify({ code: error.code }));
    return json({ ok: false, error: "No se pudieron consultar evaluaciones" }, 500);
  }

  const candidates = (data || []).map((evaluation: EvaluationRow) => {
    const due = dueAt(evaluation);
    const type = due ? reminderType(due.date.getTime() - now.getTime(), due.hasTime) : null;
    return { evaluation, due: due?.date || null, type };
  }).filter((item) => item.due && item.type) as { evaluation: EvaluationRow; due: Date; type: ReminderType }[];
  const summary = { scanned: data?.length || 0, eligible: candidates.length, sent: 0, skipped: 0, failed: 0 };

  for (const { evaluation, due, type } of candidates) {
    try {
      const { data: authData, error: authError } = await admin.auth.admin.getUserById(evaluation.user_id);
      const user = authData?.user;
      const email = clean(user?.email, 320).toLowerCase();
      if (authError || !user || !email || !(user.email_confirmed_at || user.confirmed_at)) { summary.skipped++; continue; }
      const claim = await claimDelivery(admin, evaluation, type, due);
      if (!claim.claimed) { summary.skipped++; continue; }
      const displayName = clean(user.user_metadata?.full_name || user.user_metadata?.name, 120).split(/\s+/)[0] || "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `evaluation-reminder/${evaluation.id}/${type}` }, body: JSON.stringify({ from: FROM_ADDRESS, to: [email], subject: subjectLine(evaluation, type), html: emailHtml(evaluation, type, due, displayName), tags: [{ name: "email_type", value: "evaluation_reminder" }, { name: "reminder_type", value: type }] }), signal: controller.signal });
      } finally { clearTimeout(timeout); }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.id) {
        const safeError = clean(payload?.message || payload?.name || "Resend rechazó el envío", 400);
        await admin.from("evaluation_reminder_deliveries").update({ status: "failed", last_error: `resend_${response.status}: ${safeError}`.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", claim.row.id).eq("status", "sending");
        summary.failed++;
        continue;
      }
      const sentAt = new Date().toISOString();
      await admin.from("evaluation_reminder_deliveries").update({ status: "sent", sent_at: sentAt, resend_email_id: clean(payload.id, 160), last_error: null, updated_at: sentAt }).eq("id", claim.row.id).eq("status", "sending");
      summary.sent++;
    } catch (caught) {
      summary.failed++;
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      const safeMessage = clean(caught instanceof Error ? caught.message : caught, 400);
      await admin.from("evaluation_reminder_deliveries").update({ status: "failed", last_error: timedOut ? "resend_timeout" : `internal: ${safeMessage}`.slice(0, 500), updated_at: new Date().toISOString() }).eq("evaluation_id", evaluation.id).eq("reminder_type", type).eq("status", "sending");
      console.error("[evaluation-reminders] Error seguro", JSON.stringify({ evaluation_id: evaluation.id, type, timed_out: timedOut }));
    }
  }

  console.info("[evaluation-reminders] Ejecución completada", JSON.stringify(summary));
  return json({ ok: true, ...summary, timezone: TIME_ZONE, no_time_rule: "24h_only" });
});
