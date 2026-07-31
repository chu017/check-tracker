import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, GenerativeModel, Schema, SchemaType } from "@google/generative-ai";

const MAX_RETRIES = 3;

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
  return error?.status === 503 || /overloaded|high demand/i.test(error?.message || "");
}

async function generateWithRetry(model: GenerativeModel, parts: (string | { inlineData: { data: string; mimeType: string } })[]) {
  let lastError: any;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await model.generateContent(parts);
    } catch (error: any) {
      lastError = error;
      if (!isRetryableError(error) || attempt === MAX_RETRIES - 1) {
        throw error;
      }
      const backoffMs = 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
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

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: CHECK_DATA_SCHEMA,
      },
    });

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

    const response = await generateWithRetry(model, [prompt, imagePart]);
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
      ? "Gemini is currently overloaded and didn't respond after several retries. Please try again in a moment."
      : error.message || "An error occurred while analyzing the check image.";
    return NextResponse.json({ error: message }, { status: retryable ? 503 : 500 });
  }
}
