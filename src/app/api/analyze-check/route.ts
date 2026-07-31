import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";

// Vercel Hobby allows configuring this up to 60s, but stay conservative:
// keep comfortably under whatever the actual plan/runtime enforces so a
// slow chain fails with our own JSON error instead of a platform timeout.
export const maxDuration = 20;

// Tried in order, one attempt each. Each model has its own capacity pool, so
// falling back to a different model beats retrying the same overloaded one,
// and skipping in-model retries keeps the whole chain well under maxDuration.
// Stick to the same (3.x) generation as the primary model — older models
// (2.5-flash and earlier) are being locked out for new API projects even
// though they still show up in the models list.
const MODEL_FALLBACK_CHAIN = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];

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
      return await model.generateContent(parts);
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

    // Validate size (10 MB maximum)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size exceeds the 10 MB limit." },
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
      ? "None of the configured Gemini models are available right now (overloaded, rate-limited, or no longer accessible). Please try again shortly."
      : error.message || "An error occurred while analyzing the check image.";
    return NextResponse.json({ error: message }, { status: fallbackExhausted ? 503 : 500 });
  }
}
