import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";

// Vercel Hobby allows configuring this up to 60s; 30s leaves headroom for
// the fallback chain below plus request/response overhead.
export const maxDuration = 30;

// Tried in order. Each model has its own capacity pool, so when the primary
// is overloaded, falling back to another model succeeds far more often than
// just retrying the same one.
const MODEL_FALLBACK_CHAIN = ["gemini-3.5-flash", "gemini-2.5-flash"];
const RETRIES_PER_MODEL = 2;

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

function isRetryableError(error: any): boolean {
  return (
    error?.status === 503 ||
    error?.status === 429 ||
    /overloaded|high demand/i.test(error?.message || "")
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

    for (let attempt = 0; attempt < RETRIES_PER_MODEL; attempt++) {
      try {
        return await model.generateContent(parts);
      } catch (error: any) {
        lastError = error;
        if (!isRetryableError(error)) {
          throw error;
        }
        if (attempt < RETRIES_PER_MODEL - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
    }
    // This model's retries are exhausted — move on to the next one in the chain.
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
    const retryable = isRetryableError(error);
    const message = retryable
      ? "Gemini is currently overloaded across all available models. Please try again in a moment."
      : error.message || "An error occurred while analyzing the check image.";
    return NextResponse.json({ error: message }, { status: retryable ? 503 : 500 });
  }
}
