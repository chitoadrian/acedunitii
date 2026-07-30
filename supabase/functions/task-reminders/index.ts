import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "AC Edunity <noreply@edunity.me>";
const APP_URL = "https://edunity.me";
const PROJECT_TIME_ZONE = "America/Guayaquil";
const DEFAULT_DUE_TIME = "18:00";
const MAX_ATTEMPTS = 3;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

type ReminderType = "due_24h" | "due_2h";
type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  status: string;
  updated_at: string;
  subjects: { name?: string } | { name?: string }[] | null;
};

function cleanText(value: unknown, maxLength = 400) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function escapeHtml(value: unknown) {
  return cleanText(value, 300)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getAdminKey() {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return cleanText(keys?.default, 1000);
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

function localDueAt(date: string, time: string | null) {
  const safeTime = /^\d{2}:\d{2}/.test(time || "") ? String(time).slice(0, 5) : DEFAULT_DUE_TIME;
  // Ecuador continental currently uses UTC-05:00 without daylight-saving changes.
  const parsed = new Date(`${date}T${safeTime}:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function reminderFor(remainingMs: number): ReminderType | null {
  const hours = remainingMs / 3_600_000;
  if (hours >= 0 && hours <= 2) return "due_2h";
  if (hours > 2 && hours <= 24) return "due_24h";
  return null;
}

function firstName(profileName: unknown, metadata: Record<string, unknown> | undefined) {
  const raw = cleanText(profileName || metadata?.full_name || metadata?.name, 120);
  if (!raw || ["undefined", "null"].includes(raw.toLowerCase())) return "";
  return raw.split(/\s+/)[0] || "";
}

function subjectName(task: TaskRow) {
  if (Array.isArray(task.subjects)) return cleanText(task.subjects[0]?.name, 160);
  return cleanText(task.subjects?.name, 160);
}

function formatDue(dueAt: Date) {
  const date = new Intl.DateTimeFormat("es-EC", {
    timeZone: PROJECT_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(dueAt);
  const time = new Intl.DateTimeFormat("es-EC", {
    timeZone: PROJECT_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(dueAt);
  return { date, time };
}

function remainingLabel(type: ReminderType) {
  return type === "due_2h" ? "Menos de 2 horas" : "Menos de 24 horas";
}

function emailSubject(type: ReminderType) {
  return type === "due_2h" ? "Tu tarea vence pronto — AC Edunity" : "Tu tarea vence mañana — AC Edunity";
}

function buildEmailHtml(task: TaskRow, type: ReminderType, name: string, dueAt: Date) {
  const due = formatDue(dueAt);
  const subject = subjectName(task);
  const greeting = name ? `Hola, ${escapeHtml(name)}.` : "Hola.";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media(max-width:620px){.shell{width:100%!important}.body{padding:26px 20px!important}.button{display:block!important}}</style></head>
<body style="margin:0;background:#eef2f8;font-family:Arial,Helvetica,sans-serif;color:#24314d">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f8"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" class="shell" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 36px rgba(31,45,88,.13)">
<tr><td style="padding:32px;background:linear-gradient(135deg,#6554d9,#486fea 58%,#43b9e8);color:#fff"><div style="font-size:13px;font-weight:700;letter-spacing:1.4px">AC EDUNITY</div><h1 style="margin:10px 0 0;font-size:28px;line-height:35px">${escapeHtml(emailSubject(type).replace(" — AC Edunity",""))}</h1></td></tr>
<tr><td class="body" style="padding:34px 40px 38px"><p style="margin:0 0 18px;font-size:16px;line-height:25px;color:#55627b">${greeting} Este es un recordatorio de tu actividad académica.</p>
<div style="padding:22px;border:1px solid #dfe5f2;border-radius:16px;background:#f8f9fd">
<div style="font-size:20px;font-weight:800;color:#273452">${escapeHtml(task.title)}</div>
${subject ? `<div style="margin-top:8px;font-size:14px;color:#6554d9;font-weight:700">${escapeHtml(subject)}</div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px"><tr><td style="padding:8px 0;color:#6a758a">Fecha límite</td><td align="right" style="padding:8px 0;font-weight:700;color:#2a3753">${escapeHtml(due.date)}</td></tr><tr><td style="padding:8px 0;color:#6a758a">Hora límite</td><td align="right" style="padding:8px 0;font-weight:700;color:#2a3753">${escapeHtml(due.time)}</td></tr><tr><td style="padding:8px 0;color:#6a758a">Tiempo restante</td><td align="right" style="padding:8px 0;font-weight:800;color:#3a74d8">${remainingLabel(type)}</td></tr></table>
</div>
<table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin:26px auto 16px"><tr><td bgcolor="#6554d9" style="border-radius:12px"><a class="button" href="${APP_URL}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:700">Ver mi tarea</a></td></tr></table>
<p style="margin:0;text-align:center;font-size:13px;line-height:20px;color:#7a8497">Puedes administrar los recordatorios desde Configuración en AC Edunity.</p></td></tr>
<tr><td align="center" style="padding:22px;background:#172341;color:#dce6fb;font-size:13px">AC Edunity · Gestión educativa inteligente · <a href="${APP_URL}" style="color:#7ed7f5">edunity.me</a></td></tr>
</table></td></tr></table></body></html>`;
}

function buildEmailText(task: TaskRow, type: ReminderType, name: string, dueAt: Date) {
  const due = formatDue(dueAt);
  const subject = subjectName(task);
  return [
    name ? `Hola, ${name}.` : "Hola.",
    emailSubject(type).replace(" — AC Edunity", ""),
    `Tarea: ${task.title}`,
    subject ? `Materia: ${subject}` : "",
    `Fecha límite: ${due.date}`,
    `Hora límite: ${due.time}`,
    `Tiempo restante: ${remainingLabel(type)}`,
    `Ver mi tarea: ${APP_URL}`,
    "",
    "AC Edunity",
  ].filter(Boolean).join("\n");
}

async function claimDelivery(admin: ReturnType<typeof createClient>, task: TaskRow, type: ReminderType, dueAt: Date) {
  const now = new Date().toISOString();
  const scheduledFor = new Date(dueAt.getTime() - (type === "due_2h" ? 2 : 24) * 3_600_000).toISOString();
  const base = {
    user_id: task.user_id, task_id: task.id, reminder_type: type,
    status: "sending", scheduled_for: scheduledFor, task_due_at: dueAt.toISOString(),
    attempts: 1, updated_at: now,
  };
  const { data: inserted, error: insertError } = await admin.from("task_reminder_deliveries").insert(base).select("*").single();
  if (!insertError && inserted) return { claimed: true, row: inserted };
  if (insertError?.code !== "23505") throw insertError;

  const { data: row, error } = await admin.from("task_reminder_deliveries")
    .select("*").eq("task_id", task.id).eq("reminder_type", type).single();
  if (error || !row) throw error || new Error("delivery_not_found");
  if (row.status === "sent" || row.sent_at || row.status === "cancelled") return { claimed: false, reason: row.status };
  if (Number(row.attempts || 0) >= MAX_ATTEMPTS) return { claimed: false, reason: "max_attempts" };
  const stale = Date.now() - new Date(row.updated_at).getTime() >= CLAIM_TIMEOUT_MS;
  if (row.status === "sending" && !stale) return { claimed: false, reason: "in_progress" };

  const { data: claimed, error: claimError } = await admin.from("task_reminder_deliveries")
    .update({ status: "sending", attempts: Number(row.attempts || 0) + 1, last_error: null, updated_at: now, task_due_at: dueAt.toISOString(), scheduled_for: scheduledFor })
    .eq("id", row.id).eq("status", row.status).eq("updated_at", row.updated_at).select("*");
  if (claimError) throw claimError;
  return claimed?.length ? { claimed: true, row: claimed[0] } : { claimed: false, reason: "in_progress" };
}

async function createInternalNotification(admin: ReturnType<typeof createClient>, task: TaskRow, type: ReminderType, dueAt: Date) {
  const due = formatDue(dueAt);
  const title = type === "due_2h" ? "Tarea urgente" : "Tarea próxima a vencer";
  const message = type === "due_2h"
    ? `${task.title} vence hoy a las ${due.time}.`
    : `${task.title} vence mañana a las ${due.time}.`;
  const { error } = await admin.from("internal_notifications").upsert({
    user_id: task.user_id, task_id: task.id, notification_type: type,
    title, message, scheduled_for: new Date().toISOString(),
  }, { onConflict: "task_id,notification_type", ignoreDuplicates: true });
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = getAdminKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!supabaseUrl || !adminKey || !resendKey) {
    console.error("[task-reminders] Configuración incompleta", JSON.stringify({
      supabase: Boolean(supabaseUrl), admin_key: Boolean(adminKey), resend_key: Boolean(resendKey),
    }));
    return json({ ok: false, error: "Configuración interna incompleta" }, 503);
  }

  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const fromDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString().slice(0, 10);
  const throughDate = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: tasks, error: taskError } = await admin.from("tasks")
    .select("id,user_id,title,due_date,due_time,status,updated_at,subjects(name)")
    .eq("status", "pending").not("due_date", "is", null)
    .gte("due_date", fromDate).lte("due_date", throughDate).limit(500);
  if (taskError) {
    console.error("[task-reminders] Consulta falló", JSON.stringify({ code: taskError.code }));
    return json({ ok: false, error: "No se pudieron consultar tareas" }, 500);
  }

  const candidates = (tasks || []).map((task: TaskRow) => {
    const dueAt = localDueAt(task.due_date, task.due_time);
    return { task, dueAt, type: dueAt ? reminderFor(dueAt.getTime() - now.getTime()) : null };
  }).filter((item) => item.dueAt && item.type) as { task: TaskRow; dueAt: Date; type: ReminderType }[];

  const userIds = [...new Set(candidates.map(({ task }) => task.user_id))];
  const [{ data: prefs }, { data: profiles }] = await Promise.all([
    userIds.length ? admin.from("user_preferences").select("user_id,reminders_enabled").in("user_id", userIds) : Promise.resolve({ data: [] }),
    userIds.length ? admin.from("profiles").select("id,full_name").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const enabled = new Set((prefs || []).filter((p) => p.reminders_enabled === true).map((p) => p.user_id));
  const names = new Map((profiles || []).map((p) => [p.id, p.full_name]));

  const summary = { scanned: tasks?.length || 0, eligible: candidates.length, sent: 0, skipped: 0, failed: 0, internal: 0 };
  for (const { task, dueAt, type } of candidates) {
    if (!enabled.has(task.user_id)) { summary.skipped++; continue; }

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(task.user_id);
    const user = authData?.user;
    const email = cleanText(user?.email, 320).toLowerCase();
    if (authError || !user || !email || !(user.email_confirmed_at || user.confirmed_at)) {
      summary.skipped++;
      console.warn("[task-reminders] Usuario sin correo confirmado", JSON.stringify({ user_id: task.user_id }));
      continue;
    }

    try {
      await createInternalNotification(admin, task, type, dueAt);
      summary.internal++;

      const claim = await claimDelivery(admin, task, type, dueAt);
      if (!claim.claimed) { summary.skipped++; continue; }

      const displayName = firstName(names.get(task.user_id), user.user_metadata as Record<string, unknown> | undefined);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `task-reminder/${task.id}/${type}`,
          },
          body: JSON.stringify({
            from: FROM_ADDRESS, to: [email], subject: emailSubject(type),
            html: buildEmailHtml(task, type, displayName, dueAt),
            text: buildEmailText(task, type, displayName, dueAt),
            tags: [{ name: "email_type", value: "task_reminder" }, { name: "reminder_type", value: type }],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.id) {
        const safeError = cleanText(payload?.message || payload?.name || "Resend rechazó el envío", 400);
        await admin.from("task_reminder_deliveries").update({
          status: "failed", last_error: `resend_${response.status}: ${safeError}`.slice(0, 500), updated_at: new Date().toISOString(),
        }).eq("id", claim.row.id).eq("status", "sending");
        summary.failed++;
        console.error("[task-reminders] Resend falló", JSON.stringify({ task_id: task.id, type, status: response.status }));
        continue;
      }

      const sentAt = new Date().toISOString();
      const { error: sentError } = await admin.from("task_reminder_deliveries").update({
        status: "sent", sent_at: sentAt, resend_email_id: cleanText(payload.id, 160), last_error: null, updated_at: sentAt,
      }).eq("id", claim.row.id).eq("status", "sending");
      if (sentError) throw sentError;
      summary.sent++;
    } catch (error) {
      summary.failed++;
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      const safeMessage = cleanText(error instanceof Error ? error.message : error, 400);
      await admin.from("task_reminder_deliveries").update({
        status: "failed", last_error: timedOut ? "resend_timeout" : `internal: ${safeMessage}`.slice(0, 500), updated_at: new Date().toISOString(),
      }).eq("task_id", task.id).eq("reminder_type", type).eq("status", "sending");
      console.error("[task-reminders] Error seguro", JSON.stringify({ task_id: task.id, type, timed_out: timedOut }));
    }
  }

  console.info("[task-reminders] Ejecución completada", JSON.stringify(summary));
  return json({ ok: true, ...summary, timezone: PROJECT_TIME_ZONE, default_due_time: DEFAULT_DUE_TIME });
});
