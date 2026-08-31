import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "AC Edunity <noreply@edunity.me>";
const APP_URL = "https://edunity.me";
const TIME_ZONE = "America/Guayaquil";
const MAX_ATTEMPTS = 3;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

type EntityType = "project" | "stage" | "subtask";
type ReminderType = "due_24h" | "due_2h";
type Candidate = {
  entityType: EntityType;
  id: string;
  userId: string;
  projectId: string;
  stageId: string | null;
  title: string;
  description: string;
  dueDate: string;
  dueTime: string;
  priority: string;
  status: string;
};

function clean(value: unknown, max = 400) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return clean(value, 800).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
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

function projectDueAt(candidate: Candidate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.dueDate) || !/^\d{2}:\d{2}/.test(candidate.dueTime)) return null;
  const dueAt = new Date(`${candidate.dueDate}T${candidate.dueTime.slice(0, 5)}:00-05:00`);
  return Number.isNaN(dueAt.getTime()) ? null : dueAt;
}

function reminderFor(remainingMs: number): ReminderType | null {
  const hours = remainingMs / 3_600_000;
  if (hours >= 0 && hours <= 2) return "due_2h";
  if (hours > 2 && hours <= 24) return "due_24h";
  return null;
}

function localDateKey(date: Date) {
  return new Date(date.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

function formatDue(date: Date) {
  return {
    date: new Intl.DateTimeFormat("es-EC", {
      timeZone: TIME_ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("es-EC", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date),
  };
}

function priorityLabel(priority: string) {
  return ({ low: "Baja", medium: "Media", high: "Alta" } as Record<string, string>)[priority] || "Media";
}

function emailSubject(entityType: EntityType, reminderType: ReminderType) {
  if (entityType === "project") {
    return reminderType === "due_2h" ? "Tu proyecto vence pronto — AC Edunity" : "Tu proyecto vence mañana — AC Edunity";
  }
  if (entityType === "subtask") {
    return reminderType === "due_2h" ? "Tu subtarea vence pronto — AC Edunity" : "Tu subtarea vence mañana — AC Edunity";
  }
  return reminderType === "due_2h" ? "Tu etapa vence pronto — AC Edunity" : "Tu etapa vence mañana — AC Edunity";
}

function emailHeading(entityType: EntityType, reminderType: ReminderType) {
  const entity = entityType === "project" ? "proyecto" : entityType === "subtask" ? "subtarea" : "etapa";
  return `Tu ${entity} vence ${reminderType === "due_2h" ? "pronto" : "mañana"}`;
}

function remainingLabel(reminderType: ReminderType) {
  return reminderType === "due_2h" ? "Aproximadamente 2 horas" : "Aproximadamente 24 horas";
}

function detailRow(label: string, value: string, accent = false) {
  if (!value) return "";
  return `<tr><td style="padding:8px 0;color:#6a758a">${escapeHtml(label)}</td><td align="right" style="padding:8px 0;font-weight:${accent ? "800" : "700"};color:${accent ? "#3a74d8" : "#2a3753"}">${escapeHtml(value)}</td></tr>`;
}

function emailHtml(
  candidate: Candidate,
  reminderType: ReminderType,
  dueAt: Date,
  firstName: string,
  projectName: string,
  stageName: string,
  stageProgress: string,
) {
  const due = formatDue(dueAt);
  const greeting = firstName ? `Hola, ${escapeHtml(firstName)}.` : "Hola.";
  const details = [
    candidate.entityType !== "project" ? detailRow("Proyecto", projectName) : "",
    candidate.entityType === "project" ? detailRow("Materia", stageName) : "",
    candidate.entityType === "subtask" ? detailRow("Etapa", stageName) : "",
    candidate.entityType !== "stage" ? detailRow("Prioridad", priorityLabel(candidate.priority)) : "",
    candidate.entityType !== "subtask" ? detailRow("Progreso", stageProgress) : "",
    detailRow("Fecha límite", due.date),
    detailRow("Hora límite", due.time),
    detailRow("Tiempo restante", remainingLabel(reminderType), true),
  ].join("");
  const description = clean(candidate.description, 800);

  const entityLabel = candidate.entityType === "project" ? "el proyecto" : candidate.entityType === "subtask" ? "la subtarea" : "la etapa";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media(max-width:620px){.shell{width:100%!important}.body{padding:26px 20px!important}.button{display:block!important}.detail td{display:block!important;text-align:left!important;padding:4px 0!important}.detail td+td{padding-bottom:10px!important}}</style></head>
<body style="margin:0;background:#eef2f8;font-family:Arial,Helvetica,sans-serif;color:#24314d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f8"><tr><td align="center" style="padding:28px 12px"><table role="presentation" class="shell" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 36px rgba(31,45,88,.13)"><tr><td style="padding:32px;background:linear-gradient(135deg,#6554d9,#486fea 58%,#43b9e8);color:#fff"><div style="font-size:13px;font-weight:700;letter-spacing:1.4px">AC EDUNITY</div><h1 style="margin:10px 0 0;font-size:28px;line-height:35px">${escapeHtml(emailHeading(candidate.entityType, reminderType))}</h1></td></tr><tr><td class="body" style="padding:34px 40px 38px"><p style="margin:0 0 18px;font-size:16px;line-height:25px;color:#55627b">${greeting} Este es tu recordatorio académico.</p><div style="padding:22px;border:1px solid #dfe5f2;border-radius:16px;background:#f8f9fd"><div style="font-size:20px;font-weight:800;color:#273452">${escapeHtml(candidate.title)}</div><table role="presentation" class="detail" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px">${details}</table>${description ? `<p style="margin:18px 0 0;line-height:23px;color:#55627b"><b>Descripción:</b> ${escapeHtml(description)}</p>` : ""}</div><table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin:26px auto 16px"><tr><td bgcolor="#6554d9" style="border-radius:12px"><a class="button" href="${APP_URL}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:700">Ver mi proyecto</a></td></tr></table><p style="margin:0;text-align:center;font-size:13px;line-height:20px;color:#7a8497">Puedes administrar este recordatorio al editar ${entityLabel} en AC Edunity.</p></td></tr><tr><td align="center" style="padding:22px;background:#172341;color:#dce6fb;font-size:13px">AC Edunity · Gestión educativa inteligente · <a href="${APP_URL}" style="color:#7ed7f5">edunity.me</a></td></tr></table></td></tr></table></body></html>`;
}

function emailText(
  candidate: Candidate,
  reminderType: ReminderType,
  dueAt: Date,
  firstName: string,
  projectName: string,
  stageName: string,
  stageProgress: string,
) {
  const due = formatDue(dueAt);
  return [
    firstName ? `Hola, ${firstName}.` : "Hola.",
    `${emailHeading(candidate.entityType, reminderType)}.`,
    `${candidate.entityType === "project" ? "Proyecto" : candidate.entityType === "subtask" ? "Subtarea" : "Etapa"}: ${candidate.title}`,
    candidate.entityType !== "project" && projectName ? `Proyecto: ${projectName}` : "",
    candidate.entityType === "project" && stageName ? `Materia: ${stageName}` : "",
    candidate.entityType === "subtask" && stageName ? `Etapa: ${stageName}` : "",
    candidate.entityType !== "stage" ? `Prioridad: ${priorityLabel(candidate.priority)}` : "",
    candidate.entityType !== "subtask" && stageProgress ? `Progreso: ${stageProgress}` : "",
    `Fecha límite: ${due.date}`,
    `Hora límite: ${due.time}`,
    `Tiempo restante: ${remainingLabel(reminderType)}`,
    `Ver mi proyecto: ${APP_URL}`,
    "",
    "AC Edunity · Gestión educativa inteligente",
  ].filter(Boolean).join("\n");
}

async function claimDelivery(
  admin: ReturnType<typeof createClient>,
  candidate: Candidate,
  reminderType: ReminderType,
  dueAt: Date,
) {
  const now = new Date().toISOString();
  const scheduledFor = new Date(dueAt.getTime() - (reminderType === "due_2h" ? 2 : 24) * 3_600_000).toISOString();
  const base = {
    user_id: candidate.userId,
    entity_type: candidate.entityType,
    entity_id: candidate.id,
    reminder_type: reminderType,
    status: "sending",
    scheduled_for: scheduledFor,
    due_at: dueAt.toISOString(),
    attempts: 1,
    updated_at: now,
  };
  const { data: inserted, error: insertError } = await admin.from("project_reminder_deliveries").insert(base).select("*").single();
  if (!insertError && inserted) return { claimed: true, row: inserted };
  if (insertError?.code !== "23505") throw insertError;

  const { data: delivery, error } = await admin.from("project_reminder_deliveries")
    .select("*")
    .eq("entity_type", candidate.entityType)
    .eq("entity_id", candidate.id)
    .eq("reminder_type", reminderType)
    .single();
  if (error || !delivery) throw error || new Error("delivery_not_found");
  if (delivery.status === "sent" || delivery.sent_at || delivery.status === "cancelled") {
    return { claimed: false, reason: delivery.status };
  }
  if (Number(delivery.attempts || 0) >= MAX_ATTEMPTS) return { claimed: false, reason: "max_attempts" };
  const stale = Date.now() - new Date(delivery.updated_at).getTime() >= CLAIM_TIMEOUT_MS;
  if (delivery.status === "sending" && !stale) return { claimed: false, reason: "in_progress" };

  const { data: claimed, error: claimError } = await admin.from("project_reminder_deliveries")
    .update({
      status: "sending",
      attempts: Number(delivery.attempts || 0) + 1,
      last_error: null,
      updated_at: now,
      due_at: dueAt.toISOString(),
      scheduled_for: scheduledFor,
    })
    .eq("id", delivery.id)
    .eq("status", delivery.status)
    .eq("updated_at", delivery.updated_at)
    .select("*");
  if (claimError) throw claimError;
  return claimed?.length ? { claimed: true, row: claimed[0] } : { claimed: false, reason: "in_progress" };
}

async function sendEmail(
  resendKey: string,
  candidate: Candidate,
  reminderType: ReminderType,
  dueAt: Date,
  email: string,
  firstName: string,
  projectName: string,
  stageName: string,
  stageProgress: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `project-reminder/${candidate.entityType}/${candidate.id}/${reminderType}`,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: emailSubject(candidate.entityType, reminderType),
        html: emailHtml(candidate, reminderType, dueAt, firstName, projectName, stageName, stageProgress),
        text: emailText(candidate, reminderType, dueAt, firstName, projectName, stageName, stageProgress),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(payload?.message || `resend_http_${response.status}`, 500));
    return clean(payload?.id, 180);
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = getAdminKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!supabaseUrl || !adminKey || !resendKey) {
    console.error("[project-reminders] Configuración incompleta", JSON.stringify({
      supabase: Boolean(supabaseUrl),
      admin_key: Boolean(adminKey),
      resend_key: Boolean(resendKey),
    }));
    return json({ ok: false, error: "Configuración interna incompleta" }, 503);
  }

  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const fromDate = localDateKey(new Date(now.getTime() - 60 * 60 * 1000));
  const throughDate = localDateKey(new Date(now.getTime() + 25 * 60 * 60 * 1000));

  const [projectResult, stageResult, subtaskResult] = await Promise.all([
    admin.from("projects")
      .select("id,user_id,subject_id,title,description,due_date,due_time,priority,status,reminders_enabled")
      .eq("reminders_enabled", true)
      .not("due_date", "is", null)
      .not("due_time", "is", null)
      .neq("status", "completed")
      .gte("due_date", fromDate)
      .lte("due_date", throughDate),
    admin.from("project_stages")
      .select("id,user_id,project_id,title,description,due_date,due_time,status,reminders_enabled")
      .eq("reminders_enabled", true)
      .not("due_date", "is", null)
      .not("due_time", "is", null)
      .neq("status", "completed")
      .gte("due_date", fromDate)
      .lte("due_date", throughDate),
    admin.from("project_subtasks")
      .select("id,user_id,project_id,stage_id,title,description,due_date,due_time,priority,status,reminders_enabled")
      .eq("reminders_enabled", true)
      .not("due_date", "is", null)
      .not("due_time", "is", null)
      .neq("status", "completed")
      .gte("due_date", fromDate)
      .lte("due_date", throughDate),
  ]);

  if (projectResult.error || stageResult.error || subtaskResult.error) {
    const message = clean(projectResult.error?.message || stageResult.error?.message || subtaskResult.error?.message || "candidate_query_failed", 500);
    console.error("[project-reminders] Error consultando candidatos", message);
    return json({ ok: false, error: "No se pudieron consultar los recordatorios" }, 500);
  }

  const candidates: Candidate[] = [
    ...(projectResult.data || []).map((row) => ({
      entityType: "project" as const,
      id: row.id,
      userId: row.user_id,
      projectId: row.id,
      stageId: null,
      title: clean(row.title, 220),
      description: clean(row.description, 800),
      dueDate: clean(row.due_date, 10),
      dueTime: clean(row.due_time, 8),
      priority: clean(row.priority, 30),
      status: clean(row.status, 30),
    })),
    ...(stageResult.data || []).map((row) => ({
      entityType: "stage" as const,
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      stageId: row.id,
      title: clean(row.title, 220),
      description: clean(row.description, 800),
      dueDate: clean(row.due_date, 10),
      dueTime: clean(row.due_time, 8),
      priority: "",
      status: clean(row.status, 30),
    })),
    ...(subtaskResult.data || []).map((row) => ({
      entityType: "subtask" as const,
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      stageId: row.stage_id,
      title: clean(row.title, 220),
      description: clean(row.description, 800),
      dueDate: clean(row.due_date, 10),
      dueTime: clean(row.due_time, 8),
      priority: clean(row.priority, 30),
      status: clean(row.status, 30),
    })),
  ];

  if (!candidates.length) return json({ ok: true, scanned: 0, eligible: 0, sent: 0, skipped: 0, failed: 0 });

  const userIds = [...new Set(candidates.map((item) => item.userId))];
  const projectIds = [...new Set(candidates.map((item) => item.projectId))];
  const stageIds = [...new Set(candidates.map((item) => item.stageId).filter(Boolean))] as string[];
  const [preferencesResult, profilesResult, projectsResult, subjectsResult, stagesResult, stageSubtasksResult] = await Promise.all([
    admin.from("user_preferences").select("user_id,reminders_enabled").in("user_id", userIds),
    admin.from("profiles").select("id,full_name").in("id", userIds),
    admin.from("projects").select("id,title,subject_id").in("id", projectIds),
    admin.from("subjects").select("id,name").in("user_id", userIds),
    stageIds.length ? admin.from("project_stages").select("id,title").in("id", stageIds) : Promise.resolve({ data: [], error: null }),
    projectIds.length ? admin.from("project_subtasks").select("project_id,stage_id,status").in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
  ]);

  const metadataError = preferencesResult.error || profilesResult.error || projectsResult.error || subjectsResult.error || stagesResult.error || stageSubtasksResult.error;
  if (metadataError) {
    console.error("[project-reminders] Error consultando metadatos", clean(metadataError.message, 500));
    return json({ ok: false, error: "No se pudieron consultar las preferencias" }, 500);
  }

  const preferenceMap = new Map((preferencesResult.data || []).map((row) => [row.user_id, row.reminders_enabled === true]));
  const profileMap = new Map((profilesResult.data || []).map((row) => [row.id, clean(row.full_name, 180).split(/\s+/)[0] || ""]));
  const projectMap = new Map((projectsResult.data || []).map((row) => [row.id, { title: clean(row.title, 220), subjectId: clean(row.subject_id, 80) }]));
  const subjectMap = new Map((subjectsResult.data || []).map((row) => [row.id, clean(row.name, 180)]));
  const stageMap = new Map((stagesResult.data || []).map((row) => [row.id, clean(row.title, 220)]));
  const stageCounts = new Map<string, { total: number; completed: number }>();
  const projectCounts = new Map<string, { total: number; completed: number }>();
  for (const row of stageSubtasksResult.data || []) {
    const count = stageCounts.get(row.stage_id) || { total: 0, completed: 0 };
    count.total += 1;
    if (row.status === "completed") count.completed += 1;
    stageCounts.set(row.stage_id, count);
    const projectCount = projectCounts.get(row.project_id) || { total: 0, completed: 0 };
    projectCount.total += 1;
    if (row.status === "completed") projectCount.completed += 1;
    projectCounts.set(row.project_id, projectCount);
  }

  const authUsers = new Map<string, Awaited<ReturnType<typeof admin.auth.admin.getUserById>>>();
  let eligible = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      if (preferenceMap.get(candidate.userId) !== true || candidate.status === "completed") {
        skipped += 1;
        continue;
      }
      const dueAt = projectDueAt(candidate);
      const reminderType = dueAt ? reminderFor(dueAt.getTime() - now.getTime()) : null;
      if (!dueAt || !reminderType) {
        skipped += 1;
        continue;
      }
      eligible += 1;

      let authResult = authUsers.get(candidate.userId);
      if (!authResult) {
        authResult = await admin.auth.admin.getUserById(candidate.userId);
        authUsers.set(candidate.userId, authResult);
      }
      const user = authResult.data?.user;
      if (authResult.error || !user?.email || !(user.email_confirmed_at || user.confirmed_at)) {
        skipped += 1;
        continue;
      }

      const claim = await claimDelivery(admin, candidate, reminderType, dueAt);
      if (!claim.claimed || !claim.row) {
        skipped += 1;
        continue;
      }

      const projectInfo = projectMap.get(candidate.projectId);
      const projectName = projectInfo?.title || "Proyecto";
      const stageName = candidate.entityType === "project"
        ? subjectMap.get(projectInfo?.subjectId || "") || "Sin materia"
        : candidate.stageId ? stageMap.get(candidate.stageId) || "" : "";
      const count = candidate.entityType === "project" ? projectCounts.get(candidate.projectId) : candidate.stageId ? stageCounts.get(candidate.stageId) : null;
      const stageProgress = count?.total ? `${count.completed} de ${count.total} subtareas completadas` : "Sin subtareas registradas";

      try {
        const resendMessageId = await sendEmail(
          resendKey,
          candidate,
          reminderType,
          dueAt,
          user.email,
          profileMap.get(candidate.userId) || "",
          projectName,
          stageName,
          stageProgress,
        );
        const { error: sentError } = await admin.from("project_reminder_deliveries").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          resend_message_id: resendMessageId || null,
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", claim.row.id).eq("status", "sending");
        if (sentError) throw sentError;
        sent += 1;
      } catch (error) {
        const message = clean(error instanceof Error ? error.message : error, 500) || "send_failed";
        await admin.from("project_reminder_deliveries").update({
          status: "failed",
          last_error: message,
          updated_at: new Date().toISOString(),
        }).eq("id", claim.row.id).eq("status", "sending");
        console.error("[project-reminders] Falló una entrega", JSON.stringify({
          entity_type: candidate.entityType,
          reminder_type: reminderType,
          error: message,
        }));
        failed += 1;
      }
    } catch (error) {
      console.error("[project-reminders] Falló un candidato", JSON.stringify({
        entity_type: candidate.entityType,
        error: clean(error instanceof Error ? error.message : error, 500),
      }));
      failed += 1;
    }
  }

  return json({ ok: failed === 0, scanned: candidates.length, eligible, sent, skipped, failed });
});
