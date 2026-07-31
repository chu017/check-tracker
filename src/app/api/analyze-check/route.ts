import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";

// Vercel Hobby's real hard ceiling is 60s. Use most of it, but leave a
// margin for request parsing/response overhead so our own JSON error wins
// the race against a platform-level timeout, not the other way round.
export const maxDuration = 45;

// Each attempt gets its own budget so one slow/hanging model can't consume
// the whole request — 2 models x 18s still leaves headroom under maxDuration.
const PER_ATTEMPT_TIMEOUT_MS = 18000;

// Tried in order, one attempt each. Each model has its own capacity pool, so
// falling back to a different model beats retrying the same overloaded one.
// Stick to the same (3.x) generation as the primary model — older models
// (2.5-flash and earlier) are being locked out for new API projects even
// though they still show up in the models list.
const MODEL_FALLBACK_CHAIN = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];

class AttemptTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AttemptTimeoutError(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const CHECK_DATA_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    checkNumber: { type: SchemaType.STRING, nullable: true },
    checkDate: { type: SchemaType.STRING, nullable: true },
    amount: { type: SchemaType.NUMBER, nullable: true },
    payer: { type: SchemaType.STRING, nullable: true },
    payee: { type: SchemaType.STRING, nullable: true },
    bankName: { type: SchemaType.STRING, nullable: true },
    memo: { type: SchemaType.STRING, nullable: true },
  },
  required: ["checkNumber", "checkDate", "amount", "payer", "payee", "bankName", "memo"],
};

// Overload/rate-limit errors mean "this model is temporarily busy"; a 404
// means "this model isn't available to us at all" (e.g. deprecated for new
// projects, as happened with gemini-2.5-flash). Both are reasons to fall
// through to the next model in the chain rather than aborting outright.
function isFallbackWorthyError(error: any): boolean {
  return (
    error instanceof AttemptTimeoutError ||
    error?.status === 503 ||
    error?.status === 429 ||
    error?.status === 404 ||
    /overloaded|high demand|no longer available/i.test(error?.message || "")
  );
}

async function generateWithFallback(
  genAI: GoogleGenerativeAI,
  parts: (string | { inlineData: { data: string; mimeType: string } })[]
) {
  let lastError: any;
  for (const modelName of MODEL_FALLBACK_CHAIN) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: CHECK_DATA_SCHEMA,
      },
    });

    try {
      return await withTimeout(model.generateContent(parts), PER_ATTEMPT_TIMEOUT_MS);
    } catch (error: any) {
      lastError = error;
      if (!isFallbackWorthyError(error)) {
        throw error;
      }
      // Overloaded, rate-limited, or unavailable — move on to the next model immediately.
    }
  }
  throw lastError;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured on the server-side." },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file was uploaded." },
        { status: 400 }
      );
    }

    // Validate file type
    const validMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validMimeTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Only JPG, PNG, and WEBP are allowed.` },
        { status: 400 }
      );
    }

    // Vercel's serverless functions hard-cap the request body around 4.5MB;
    // the client compresses images before upload, but guard here too in case
    // that step is bypassed.
    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size exceeds the 4 MB limit." },
        { status: 400 }
      );
    }

    // Read file bytes
    const bytes = await file.arrayBuffer();
    const base64Image = Buffer.from(bytes).toString("base64");

    const genAI = new GoogleGenerativeAI(apiKey);

    const prompt = `
Analyze this check image and extract the check information. 
Return a JSON object matching this exact format:

{
  "checkNumber": null,
  "checkDate": null,
  "amount": null,
  "payer": null,
  "payee": null,
  "bankName": null,
  "memo": null
}

AI Rules:
- Do not invent or guess unreadable information.
- Return null when a field cannot be identified.
- Return the checkDate as YYYY-MM-DD.
- Return the amount as a number.
- Do not invent check type or determine whether it is Received or Sent Out.
    `;

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: file.type,
      },
    };

    const response = await generateWithFallback(genAI, [prompt, imagePart]);
    const responseText = response.response.text();

    if (!responseText) {
      throw new Error("Empty response received from Gemini API.");
    }

    // Parse AI JSON output
    let extractedData;
    try {
      extractedData = JSON.parse(responseText.trim());
    } catch {
      console.error("Gemini returned non-JSON output:", responseText);
      throw new Error("The AI returned an unreadable response. Please try again.");
    }

    return NextResponse.json(extractedData);
  } catch (error: any) {
    console.error("Error in analyze-check endpoint:", error);
    const fallbackExhausted = isFallbackWorthyError(error);
    const message = fallbackExhausted
      ? "None of the configured Gemini models responded in time (overloaded, rate-limited, too slow, or no longer accessible). Please try again shortly."
      : error.message || "An error occurred while analyzing the check image.";
    return NextResponse.json({ error: message }, { status: fallbackExhausted ? 503 : 500 });
  }
}
