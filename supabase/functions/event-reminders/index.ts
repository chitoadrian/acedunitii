import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "AC Edunity <noreply@edunity.me>";
const APP_URL = "https://edunity.me";
const TIME_ZONE = "America/Guayaquil";
const DEFAULT_EVENT_TIME = "08:00";
const MAX_ATTEMPTS = 3;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

type ReminderType = "due_24h" | "due_2h";
type EventRow = {
  id: string;
  user_id: string;
  title: string;
  type: string | null;
  event_date: string;
  event_time: string | null;
  description: string | null;
  reminders_enabled: boolean;
  subjects: { name?: string } | { name?: string }[] | null;
};

function clean(value: unknown, max = 400) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return clean(value, 600).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getAdminKey() {
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

function eventDueAt(row: EventRow) {
  const localTime = /^\d{2}:\d{2}/.test(row.event_time || "")
    ? String(row.event_time).slice(0, 5)
    : DEFAULT_EVENT_TIME;
  const date = new Date(`${row.event_date}T${localTime}:00-05:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reminderType(remainingMs: number): ReminderType | null {
  const hours = remainingMs / 3_600_000;
  if (hours >= 0 && hours <= 2) return "due_2h";
  if (hours > 2 && hours <= 24) return "due_24h";
  return null;
}

function localDateKey(date: Date) {
  return new Date(date.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

function subjectName(row: EventRow) {
  if (Array.isArray(row.subjects)) return clean(row.subjects[0]?.name, 160);
  return clean(row.subjects?.name, 160);
}

function formatDue(date: Date) {
  return {
    date: new Intl.DateTimeFormat("es-EC", {
      timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("es-EC", {
      timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date),
  };
}

function emailSubject(type: ReminderType) {
  return type === "due_2h"
    ? "Tu evento comienza pronto — AC Edunity"
    : "Tu evento es mañana — AC Edunity";
}

function remainingLabel(type: ReminderType) {
  return type === "due_2h" ? "Aproximadamente 2 horas" : "Aproximadamente 24 horas";
}

function emailHtml(row: EventRow, type: ReminderType, dueAt: Date, firstName: string) {
  const due = formatDue(dueAt);
  const subject = subjectName(row);
  const description = clean(row.description, 800);
  const greeting = firstName ? `Hola, ${escapeHtml(firstName)}.` : "Hola.";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media(max-width:620px){.shell{width:100%!important}.body{padding:26px 20px!important}.button{display:block!important}}</style></head>
<body style="margin:0;background:#eef2f8;font-family:Arial,Helvetica,sans-serif;color:#24314d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f8"><tr><td align="center" style="padding:28px 12px"><table role="presentation" class="shell" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 36px rgba(31,45,88,.13)"><tr><td style="padding:32px;background:linear-gradient(135deg,#6554d9,#486fea 58%,#43b9e8);color:#fff"><div style="font-size:13px;font-weight:700;letter-spacing:1.4px">AC EDUNITY</div><h1 style="margin:10px 0 0;font-size:28px;line-height:35px">${type === "due_2h" ? "Tu evento comienza pronto" : "Tu evento es mañana"}</h1></td></tr><tr><td class="body" style="padding:34px 40px 38px"><p style="margin:0 0 18px;font-size:16px;line-height:25px;color:#55627b">${greeting} Este es tu recordatorio académico.</p><div style="padding:22px;border:1px solid #dfe5f2;border-radius:16px;background:#f8f9fd"><div style="font-size:20px;font-weight:800;color:#273452">${escapeHtml(row.title)}</div>${subject ? `<div style="margin-top:8px;font-size:14px;color:#6554d9;font-weight:700">${escapeHtml(subject)}</div>` : ""}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px"><tr><td style="padding:8px 0;color:#6a758a">Tipo</td><td align="right" style="padding:8px 0;font-weight:700;color:#2a3753">${escapeHtml(row.type || "Evento")}</td></tr><tr><td style="padding:8px 0;color:#6a758a">Fecha</td><td align="right" style="padding:8px 0;font-weight:700;color:#2a3753">${escapeHtml(due.date)}</td></tr><tr><td style="padding:8px 0;color:#6a758a">Hora</td><td align="right" style="padding:8px 0;font-weight:700;color:#2a3753">${escapeHtml(due.time)}</td></tr><tr><td style="padding:8px 0;color:#6a758a">Tiempo restante</td><td align="right" style="padding:8px 0;font-weight:800;color:#3a74d8">${remainingLabel(type)}</td></tr></table>${description ? `<p style="margin:18px 0 0;line-height:23px;color:#55627b"><b>Descripción:</b> ${escapeHtml(description)}</p>` : ""}</div><table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin:26px auto 16px"><tr><td bgcolor="#6554d9" style="border-radius:12px"><a class="button" href="${APP_URL}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:700">Ver mi calendario</a></td></tr></table><p style="margin:0;text-align:center;font-size:13px;line-height:20px;color:#7a8497">Puedes administrar este recordatorio al editar el evento en AC Edunity.</p></td></tr><tr><td align="center" style="padding:22px;background:#172341;color:#dce6fb;font-size:13px">AC Edunity · Gestión educativa inteligente · <a href="${APP_URL}" style="color:#7ed7f5">edunity.me</a></td></tr></table></td></tr></table></body></html>`;
}

function emailText(row: EventRow, type: ReminderType, dueAt: Date, firstName: string) {
  const due = formatDue(dueAt);
  const subject = subjectName(row);
  const description = clean(row.description, 800);
  return [
    firstName ? `Hola, ${firstName}.` : "Hola.",
    type === "due_2h" ? "Tu evento comienza pronto." : "Tu evento es mañana.",
    `Evento: ${row.title}`,
    subject ? `Materia: ${subject}` : "",
    `Fecha: ${due.date}`,
    `Hora: ${due.time}`,
    description ? `Descripción: ${description}` : "",
    `Tiempo restante: ${remainingLabel(type)}`,
    `Ver mi calendario: ${APP_URL}`,
    "",
    "AC Edunity",
  ].filter(Boolean).join("\n");
}

async function claimDelivery(admin: ReturnType<typeof createClient>, row: EventRow, type: ReminderType, dueAt: Date) {
  const now = new Date().toISOString();
  const scheduledFor = new Date(dueAt.getTime() - (type === "due_2h" ? 2 : 24) * 3_600_000).toISOString();
  const base = {
    user_id: row.user_id, event_id: row.id, reminder_type: type, status: "sending",
    scheduled_for: scheduledFor, event_due_at: dueAt.toISOString(), attempts: 1, updated_at: now,
  };
  const { data: inserted, error: insertError } = await admin.from("event_reminder_deliveries").insert(base).select("*").single();
  if (!insertError && inserted) return { claimed: true, row: inserted };
  if (insertError?.code !== "23505") throw insertError;

  const { data: delivery, error } = await admin.from("event_reminder_deliveries")
    .select("*").eq("event_id", row.id).eq("reminder_type", type).single();
  if (error || !delivery) throw error || new Error("delivery_not_found");
  if (delivery.status === "sent" || delivery.sent_at || delivery.status === "cancelled") return { claimed: false, reason: delivery.status };
  if (Number(delivery.attempts || 0) >= MAX_ATTEMPTS) return { claimed: false, reason: "max_attempts" };
  const stale = Date.now() - new Date(delivery.updated_at).getTime() >= CLAIM_TIMEOUT_MS;
  if (delivery.status === "sending" && !stale) return { claimed: false, reason: "in_progress" };

  const { data: claimed, error: claimError } = await admin.from("event_reminder_deliveries")
    .update({ status: "sending", attempts: Number(delivery.attempts || 0) + 1, last_error: null, updated_at: now, event_due_at: dueAt.toISOString(), scheduled_for: scheduledFor })
    .eq("id", delivery.id).eq("status", delivery.status).eq("updated_at", delivery.updated_at).select("*");
  if (claimError) throw claimError;
  return claimed?.length ? { claimed: true, row: claimed[0] } : { claimed: false, reason: "in_progress" };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = getAdminKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!supabaseUrl || !adminKey || !resendKey) {
    console.error("[event-reminders] Configuración incompleta", JSON.stringify({
      supabase: Boolean(supabaseUrl), admin_key: Boolean(adminKey), resend_key: Boolean(resendKey),
    }));
    return json({ ok: false, error: "Configuración interna incompleta" }, 503);
  }

  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const fromDate = localDateKey(new Date(now.getTime() - 60 * 60 * 1000));
  const throughDate = localDateKey(new Date(now.getTime() + 25 * 60 * 60 * 1000));
  const { data, error } = await admin.from("events")
    .select("id,user_id,title,type,event_date,event_time,description,reminders_enabled,subjects(name)")
    .eq("reminders_enabled", true).not("event_date", "is", null)
    .gte("event_date", fromDate).lte("event_date", throughDate).limit(500);
  if (error) {
    console.error("[event-reminders] Consulta falló", JSON.stringify({ code: error.code }));
    return json({ ok: false, error: "No se pudieron consultar eventos" }, 500);
  }

  const candidates = (data || []).map((event: EventRow) => {
    const dueAt = eventDueAt(event);
    return { event, dueAt, type: dueAt ? reminderType(dueAt.getTime() - now.getTime()) : null };
  }).filter((item) => item.dueAt && item.type) as { event: EventRow; dueAt: Date; type: ReminderType }[];

  const userIds = [...new Set(candidates.map(({ event }) => event.user_id))];
  const [{ data: preferences }, { data: profiles }] = await Promise.all([
    userIds.length ? admin.from("user_preferences").select("user_id,reminders_enabled").in("user_id", userIds) : Promise.resolve({ data: [] }),
    userIds.length ? admin.from("profiles").select("id,full_name").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const enabledUsers = new Set((preferences || []).filter((row) => row.reminders_enabled === true).map((row) => row.user_id));
  const names = new Map((profiles || []).map((row) => [row.id, row.full_name]));
  const summary = { scanned: data?.length || 0, eligible: candidates.length, sent: 0, skipped: 0, failed: 0 };

  for (const { event, dueAt, type } of candidates) {
    if (!enabledUsers.has(event.user_id)) { summary.skipped++; continue; }

    try {
      const { data: authData, error: authError } = await admin.auth.admin.getUserById(event.user_id);
      const user = authData?.user;
      const email = clean(user?.email, 320).toLowerCase();
      if (authError || !user || !email || !(user.email_confirmed_at || user.confirmed_at)) {
        summary.skipped++;
        console.warn("[event-reminders] Usuario sin correo confirmado", JSON.stringify({ user_id: event.user_id }));
        continue;
      }

      const claim = await claimDelivery(admin, event, type, dueAt);
      if (!claim.claimed) { summary.skipped++; continue; }

      const firstName = clean(names.get(event.user_id) || user.user_metadata?.full_name || user.user_metadata?.name, 120).split(/\s+/)[0] || "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `event-reminder/${event.id}/${type}`,
          },
          body: JSON.stringify({
            from: FROM_ADDRESS, to: [email], subject: emailSubject(type),
            html: emailHtml(event, type, dueAt, firstName),
            text: emailText(event, type, dueAt, firstName),
            tags: [{ name: "email_type", value: "event_reminder" }, { name: "reminder_type", value: type }],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.id) {
        const safeError = clean(payload?.message || payload?.name || "Resend rechazó el envío", 400);
        await admin.from("event_reminder_deliveries").update({
          status: "failed", last_error: `resend_${response.status}: ${safeError}`.slice(0, 500), updated_at: new Date().toISOString(),
        }).eq("id", claim.row.id).eq("status", "sending");
        summary.failed++;
        console.error("[event-reminders] Resend falló", JSON.stringify({ event_id: event.id, type, status: response.status }));
        continue;
      }

      const sentAt = new Date().toISOString();
      const { error: sentError } = await admin.from("event_reminder_deliveries").update({
        status: "sent", sent_at: sentAt, resend_email_id: clean(payload.id, 160), last_error: null, updated_at: sentAt,
      }).eq("id", claim.row.id).eq("status", "sending");
      if (sentError) throw sentError;
      summary.sent++;
    } catch (caught) {
      summary.failed++;
      const timedOut = caught instanceof DOMException && caught.name === "AbortError";
      const safeMessage = clean(caught instanceof Error ? caught.message : caught, 400);
      await admin.from("event_reminder_deliveries").update({
        status: "failed", last_error: timedOut ? "resend_timeout" : `internal: ${safeMessage}`.slice(0, 500), updated_at: new Date().toISOString(),
      }).eq("event_id", event.id).eq("reminder_type", type).eq("status", "sending");
      console.error("[event-reminders] Error seguro", JSON.stringify({ event_id: event.id, type, timed_out: timedOut }));
    }
  }

  console.info("[event-reminders] Ejecución completada", JSON.stringify(summary));
  return json({ ok: true, ...summary, timezone: TIME_ZONE, default_event_time: DEFAULT_EVENT_TIME });
});
