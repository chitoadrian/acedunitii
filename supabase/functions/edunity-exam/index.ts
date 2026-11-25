import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const VISION_MODEL = "qwen/qwen3.8-27b";
const TEXT_MODEL = "openai/gpt-oss-120b";
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_TEXT = 30_000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function serviceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")?.default || ""; }
  catch { return ""; }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") throw new Error("Groq no devolvió datos estructurados");
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Respuesta de IA inválida");
  return parsed;
}

async function askGroq(model: string, content: unknown, maxTokens: number) {
  const key = Deno.env.get("prueba");
  if (!key) throw new Error("Groq no está configurado");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.25,
        max_tokens: maxTokens, response_format: { type: "json_object" } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("Límite gratuito de Groq alcanzado; inténtalo más tarde");
      throw new Error(`Groq no respondió (${res.status})`);
    }
    const data = await res.json();
    return parseObject(data?.choices?.[0]?.message?.content);
  } finally { clearTimeout(timer); }
}

function publicAttempt(row: Record<string, any>) {
  const completed = Boolean(row.completed_at);
  const questions = (Array.isArray(row.questions) ? row.questions : []).map((q: any, i: number) => ({
    number: i + 1, prompt: q.prompt, options: q.options, topic: q.topic,
    ...(completed ? { correct_index: q.correct_index, explanation: q.explanation } : {}),
  }));
  return { id: row.id, material_id: row.material_id, difficulty: row.difficulty,
    questions, answers: completed ? row.answers : null, feedback: completed ? row.feedback : null,
    score: completed ? row.score : null, created_at: row.created_at, completed_at: row.completed_at };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Método no permitido" }, 405);
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = serviceKey();
  if (!token || !url || !key) return reply({ error: "Acceso no disponible" }, 401);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: authError } = await admin.auth.getUser(token);
  if (authError || !identity.user?.id || !identity.user.email_confirmed_at) return reply({ error: "Sesión no válida" }, 401);
  const userId = identity.user.id;
  const { data: grant, error: grantError } = await admin.from("edunity_feature_access")
    .select("exam_enabled").eq("user_id", userId).maybeSingle();
  if (grantError || !grant?.exam_enabled) return reply({ error: "Exam no está habilitado para esta cuenta" }, 403);

  try {
    const body = await request.json();
    const action = text(body?.action, 32);
    if (action === "recognize") {
      const image = String(body.image || "");
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!match || match[2].length * 0.75 > MAX_IMAGE_BYTES) return reply({ error: "Imagen inválida o mayor a 3 MB" }, 400);
      const result = await askGroq(VISION_MODEL, [
        { type: "text", text: "Transcribe fielmente el texto académico visible. Señala las partes ilegibles como [ilegible]. No inventes contenido. Devuelve JSON con la clave text." },
        { type: "image_url", image_url: { url: image } },
      ], 1800);
      const recognized = text(result.text, MAX_TEXT);
      if (!recognized) throw new Error("No se reconoció texto en la imagen");
      return reply({ text: recognized });
    }
    if (action === "generate") {
      const sourceName = text(body.source_name, 180);
      const sourceText = text(body.recognized_text, MAX_TEXT);
      const difficulty = text(body.difficulty, 20);
      const count = Number(body.count);
      if (!sourceName || sourceText.length < 80 || !["basico", "intermedio", "avanzado"].includes(difficulty)
        || !Number.isInteger(count) || count < 3 || count > 8) return reply({ error: "Material o parámetros inválidos" }, 400);
      const result = await askGroq(TEXT_MODEL,
        `Genera exactamente ${count} preguntas de opción múltiple en español, dificultad ${difficulty}, basadas SOLO en el material siguiente. ` +
        `Devuelve JSON {"questions":[{"prompt":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"...","topic":"..."}]}. ` +
        `Cada pregunta debe tener cuatro opciones, una respuesta inequívoca y una explicación fundada en el material. Sin datos inventados.\nMaterial:\n${sourceText}`,
        3200);
      const raw = result.questions;
      if (!Array.isArray(raw) || raw.length !== count) throw new Error("Groq devolvió un número inesperado de preguntas");
      const questions = raw.map((q: any) => ({
        prompt: text(q.prompt, 500), options: Array.isArray(q.options) ? q.options.map((o: unknown) => text(o, 240)) : [],
        correct_index: Number(q.correct_index), explanation: text(q.explanation, 900), topic: text(q.topic, 120),
      }));
      if (questions.some((q) => !q.prompt || q.options.length !== 4 || q.options.some((o) => !o)
        || !Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index > 3
        || !q.explanation || !q.topic)) throw new Error("Groq devolvió preguntas incompletas");
      const { data: material, error: materialError } = await admin.from("exam_materials")
        .insert({ user_id: userId, source_name: sourceName, recognized_text: sourceText }).select("id").single();
      if (materialError) throw materialError;
      const { data: attempt, error: attemptError } = await admin.from("exam_attempts")
        .insert({ user_id: userId, material_id: material.id, difficulty, questions }).select("*").single();
      if (attemptError) {
        await admin.from("exam_materials").delete().eq("id", material.id).eq("user_id", userId);
        throw attemptError;
      }
      return reply({ attempt: publicAttempt(attempt) });
    }
    if (action === "grade") {
      const id = text(body.attempt_id, 80);
      const { data: row, error } = await admin.from("exam_attempts").select("*")
        .eq("id", id).eq("user_id", userId).maybeSingle();
      if (error || !row) return reply({ error: "Simulacro no encontrado" }, 404);
      if (row.completed_at) return reply({ attempt: publicAttempt(row) });
      const answers = body.answers;
      if (!Array.isArray(answers) || answers.length !== row.questions.length
        || answers.some((a: unknown) => !Number.isInteger(a) || Number(a) < 0 || Number(a) > 3))
        return reply({ error: "Responde todas las preguntas" }, 400);
      const feedback = row.questions.map((q: any, i: number) => ({ number: i + 1,
        correct: answers[i] === q.correct_index, topic: q.topic, explanation: q.explanation }));
      const score = Math.round(feedback.filter((f: any) => f.correct).length * 10000 / feedback.length) / 100;
      const { data: saved, error: saveError } = await admin.from("exam_attempts")
        .update({ answers, feedback, score, completed_at: new Date().toISOString() })
        .eq("id", id).eq("user_id", userId).is("completed_at", null).select("*").maybeSingle();
      if (saveError) throw saveError;
      if (!saved) return reply({ error: "El simulacro ya fue corregido. Recarga el historial." }, 409);
      return reply({ attempt: publicAttempt(saved) });
    }
    if (action === "history") {
      const { data, error } = await admin.from("exam_attempts")
        .select("*, exam_materials(source_name)").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return reply({ attempts: (data || []).map((row: any) => ({ ...publicAttempt(row), source_name: row.exam_materials?.source_name || "Material" })) });
    }
    if (action === "get_attempt") {
      const id = text(body.attempt_id, 80);
      const { data, error } = await admin.from("exam_attempts").select("*")
        .eq("id", id).eq("user_id", userId).maybeSingle();
      if (error || !data) return reply({ error: "Simulacro no encontrado" }, 404);
      return reply({ attempt: publicAttempt(data) });
    }
    return reply({ error: "Acción desconocida" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    console.error("[edunity-exam]", message);
    const publicMessage = message === "Límite gratuito de Groq alcanzado; inténtalo más tarde"
      || message === "No se reconoció texto en la imagen"
      ? message : "No se pudo completar la operación. Inténtalo de nuevo.";
    return reply({ error: publicMessage }, 502);
  }
});
