const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 45_000;

type TutorHistoryItem = { role?: string; content?: string };
type TutorRequestBody = {
  message?: string;
  history?: TutorHistoryItem[];
  context?: { subjects?: unknown[]; tasks?: unknown[]; resources?: unknown[] };
};

type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength = 6000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function compactAcademicItem(value: unknown) {
  if (typeof value === "string") return cleanText(value, 240);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const item = value as Record<string, unknown>;
  const allowedKeys = [
    "name",
    "title",
    "subject",
    "course",
    "status",
    "type",
    "dueDate",
    "date",
  ];

  const compact = allowedKeys.reduce<Record<string, string>>((result, key) => {
    const text = cleanText(item[key], 240);
    if (text) result[key] = text;
    return result;
  }, {});

  return Object.keys(compact).length ? compact : "";
}

function compactAcademicList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map(compactAcademicItem)
    .filter(Boolean);
}

function compactWorkspaceContext(context: TutorRequestBody["context"]) {
  return JSON.stringify({
    subjects: compactAcademicList(context?.subjects, 12),
    tasks: compactAcademicList(context?.tasks, 16),
    resources: compactAcademicList(context?.resources, 12),
  }).slice(0, 6000);
}

function buildMessages(
  message: string,
  history: TutorHistoryItem[] = [],
  context?: TutorRequestBody["context"],
): GroqMessage[] {
  const systemPrompt =
    "Eres Tutor IA de AC Edunity, un asistente educativo para estudiantes. " +
    "Responde siempre en español claro, correcto, completo y didáctico. " +
    "Explica paso a paso cuando sea necesario. Evita respuestas incompletas. " +
    "Usa títulos, listas y fórmulas cuando ayuden. No inventes datos. " +
    "Si una pregunta requiere contexto adicional, pídelo de forma breve. " +
    `Contexto académico disponible del estudiante: ${compactWorkspaceContext(context)}`;

  const safeHistory: GroqMessage[] = (Array.isArray(history) ? history : [])
    .slice(-12)
    .map((item): GroqMessage | null => {
      if (!item || (item.role !== "user" && item.role !== "assistant")) return null;
      const content = cleanText(item.content, 3500);
      if (!content) return null;
      return { role: item.role, content };
    })
    .filter((item): item is GroqMessage => Boolean(item));

  if (
    safeHistory[safeHistory.length - 1]?.role === "user" &&
    safeHistory[safeHistory.length - 1]?.content === message
  ) {
    safeHistory.pop();
  }

  return [
    { role: "system", content: systemPrompt },
    ...safeHistory,
    { role: "user", content: message },
  ];
}

function upstreamMessage(data: any) {
  return cleanText(
    data?.error?.message || data?.message || "Groq devolvió un error sin detalles",
    1200,
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({
      ok: false,
      error: "Método no permitido",
      details: {
        upstream_status: 405,
        upstream_message: "La función solo acepta solicitudes POST",
        model: GROQ_MODEL,
      },
    }, 405);
  }

  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    return jsonResponse({
      ok: false,
      error: "Tutor IA no está configurado",
      details: {
        upstream_status: null,
        upstream_message: "Falta el secreto GROQ_API_KEY",
        model: GROQ_MODEL,
      },
    }, 500);
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = await request.json() as TutorRequestBody;
    const message = cleanText(body.message, 6000);

    if (!message) {
      return jsonResponse({
        ok: false,
        error: "Mensaje vacío",
        details: {
          upstream_status: 400,
          upstream_message: "El campo message es obligatorio",
          model: GROQ_MODEL,
        },
      }, 400);
    }

    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: buildMessages(message, body.history, body.context),
        temperature: 0.5,
        max_tokens: 2400,
        top_p: 0.9,
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    const elapsedMs = Date.now() - startedAt;
    const errorMessage = upstreamMessage(data);

    console.info("[tutor-ai]", JSON.stringify({
      status: response.status,
      message: response.ok ? "Groq respondió correctamente" : errorMessage,
      model: GROQ_MODEL,
      elapsed_ms: elapsedMs,
    }));

    if (!response.ok) {
      const clientStatus = response.status === 429 ? 429 : 502;
      return jsonResponse({
        ok: false,
        error: "Groq no respondió correctamente",
        details: {
          upstream_status: response.status,
          upstream_message: errorMessage,
          model: GROQ_MODEL,
        },
      }, clientStatus);
    }

    const answer = cleanText(data?.choices?.[0]?.message?.content, 30000);
    if (!answer) {
      return jsonResponse({
        ok: false,
        error: "Groq devolvió una respuesta vacía",
        details: {
          upstream_status: response.status,
          upstream_message: "No se encontró choices[0].message.content",
          model: GROQ_MODEL,
        },
      }, 502);
    }

    return jsonResponse({
      ok: true,
      answer,
      model: data?.model || GROQ_MODEL,
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    const message = timedOut
      ? "La solicitud a Groq excedió el tiempo máximo"
      : cleanText(error instanceof Error ? error.message : error, 1200);

    console.error("[tutor-ai]", JSON.stringify({
      status: timedOut ? 504 : 500,
      message,
      model: GROQ_MODEL,
      elapsed_ms: elapsedMs,
    }));

    return jsonResponse({
      ok: false,
      error: timedOut ? "Groq tardó demasiado en responder" : "Error interno del Tutor",
      details: {
        upstream_status: timedOut ? 504 : null,
        upstream_message: message,
        model: GROQ_MODEL,
      },
    }, timedOut ? 504 : 500);
  } finally {
    clearTimeout(timeoutId);
  }
});
