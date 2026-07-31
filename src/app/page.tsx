"use client";

import React, { useState, useRef } from "react";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Calendar,
  DollarSign,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Building,
  User,
  Hash,
  Save,
  Check,
  FolderOpen,
  Sparkles,
  Sun,
  HelpCircle
} from "lucide-react";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Mobile camera captures can carry unusual filenames/encodings that some
// browsers fail to serialize into a multipart body. Re-wrapping in a File
// with a plain ASCII name sidesteps that.
function toSafeFile(file: File): File {
  const extension = MIME_EXTENSIONS[file.type] || "jpg";
  return new File([file], `check-image.${extension}`, { type: file.type });
}

// Reads an error response body once as text, then tries to interpret it as
// our own { error } JSON shape. Falls back to the raw text for cases where
// the response never reached our route handler at all — e.g. a platform-level
// timeout page, which is plain text, not JSON — so callers never crash trying
// to JSON.parse an unknown body.
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const rawText = await response.text();
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed?.error === "string" && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Not JSON — likely a platform-level error page (e.g. a function timeout).
  }
  const trimmed = rawText.trim();
  return trimmed ? trimmed.slice(0, 300) : fallback;
}

function toFriendlyErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/did not match the expected pattern/i.test(message)) {
    return "Your browser couldn't process this image. Try taking the photo again or choosing an existing one from your library.";
  }
  return message || fallback;
}

interface ExtractedData {
  checkNumber: string | null;
  checkDate: string | null;
  amount: number | null;
  payer: string | null;
  payee: string | null;
  bankName: string | null;
  memo: string | null;
}

export default function Home() {
  // App workflow state: "upload" | "loading" | "review" | "success"
  const [step, setStep] = useState<"upload" | "loading" | "review" | "success">("upload");
  const [loadingText, setLoadingText] = useState<string>("Analyzing image...");
  const [error, setError] = useState<string | null>(null);
  
  // Form input state
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [checkType, setCheckType] = useState<"Received" | "Sent Out">("Received");
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extracted/editable fields
  const [checkNumber, setCheckNumber] = useState<string>("");
  const [checkDate, setCheckDate] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [payer, setPayer] = useState<string>("");
  const [payee, setPayee] = useState<string>("");
  const [bankName, setBankName] = useState<string>("");
  const [memo, setMemo] = useState<string>("");

  // Handle file validation
  const validateAndSetFile = (selectedFile: File) => {
    setError(null);
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(selectedFile.type)) {
      setError("Unsupported file format. Please upload JPG, PNG, or WEBP.");
      return;
    }
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (selectedFile.size > maxSize) {
      setError("File is too large. Maximum size is 10 MB.");
      return;
    }

    setFile(selectedFile);
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // Analyze check action
  const handleAnalyze = async () => {
    if (!file) return;

    setStep("loading");
    setLoadingText("Sending image to Gemini Vision AI...");
    setError(null);

    const formData = new FormData();
    formData.append("file", toSafeFile(file));

    try {
      const response = await fetch("/api/analyze-check", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to analyze check image."));
      }

      const result: ExtractedData = await response.json();

      // Populate form state with AI response, replacing nulls with empty strings
      setCheckNumber(result.checkNumber || "");
      setCheckDate(result.checkDate || "");
      setAmount(result.amount !== null ? String(result.amount) : "");
      setPayer(result.payer || "");
      setPayee(result.payee || "");
      setBankName(result.bankName || "");
      setMemo(result.memo || "");

      setStep("review");
    } catch (err: unknown) {
      console.error("Analyze check failed:", err);
      setError(toFriendlyErrorMessage(err, "An unexpected error occurred."));
      setStep("upload");
    }
  };

  // Save to Lark Base action
  const handleSave = async () => {
    if (!file) return;

    setStep("loading");
    setLoadingText("Uploading check image & saving records to Lark Base...");
    setError(null);

    const parsedAmount = amount === "" ? null : parseFloat(amount);

    const formData = new FormData();
    formData.append("file", toSafeFile(file));
    formData.append(
      "data",
      JSON.stringify({
        checkType,
        checkNumber: checkNumber || null,
        checkDate: checkDate || null,
        amount: isNaN(Number(parsedAmount)) ? null : parsedAmount,
        payer: payer || null,
        payee: payee || null,
        bankName: bankName || null,
        memo: memo || null,
      })
    );

    try {
      const response = await fetch("/api/save-check", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to save record to Lark Base."));
      }

      setStep("success");
    } catch (err: unknown) {
      console.error("Save check failed:", err);
      setError(toFriendlyErrorMessage(err, "An error occurred while saving the record."));
      setStep("review");
    }
  };

  // Start over
  const handleReset = () => {
    setFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setCheckType("Received");
    setStep("upload");
    setError(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800 antialiased">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-200">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">CheckTracker</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Toggle theme"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
            >
              <Sun className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Help"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-950">Action Failed</h3>
                  <p className="text-sm text-red-800 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Upload Panel */}
          {step === "upload" && (
            <div className="grid gap-8 md:grid-cols-3">
              {/* Left Side: Drag & Drop Card */}
              <div className="md:col-span-2">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative flex min-h-[400px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 ${
                    isDragOver
                      ? "border-indigo-600 bg-indigo-50/50 scale-[0.99] shadow-inner"
                      : file
                      ? "border-slate-300 bg-white shadow-sm"
                      : "border-slate-300 bg-white hover:border-slate-400 hover:shadow-sm"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {previewUrl ? (
                    <div className="w-full h-full flex flex-col items-center justify-center">
                      <div className="relative max-h-[350px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 flex items-center justify-center shadow-inner">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt="Check Preview"
                          className="max-h-[350px] object-contain w-full select-none"
                        />
                        <button
                          onClick={handleReset}
                          className="absolute right-3 top-3 rounded-full bg-slate-900/70 p-2 text-white hover:bg-slate-900 transition-colors shadow-md backdrop-blur-sm"
                          title="Remove image"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-4 flex items-center gap-2 text-sm text-slate-600 font-medium">
                        <FileText className="h-4 w-4 text-indigo-600" />
                        <span>{file?.name}</span>
                        <span className="text-slate-400">
                          ({((file?.size || 0) / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                        <Upload className="h-8 w-8" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-950">Upload Check Image</h3>
                      <p className="mt-2 text-sm text-slate-500 max-w-sm">
                        Drag and drop your file here, or click to browse
                      </p>
                      <p className="mt-1 text-xs text-slate-400">JPG, PNG, WEBP up to 10MB</p>
                      <button
                        type="button"
                        onClick={triggerFileSelect}
                        className="mt-6 flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-all active:scale-[0.98]"
                      >
                        <FolderOpen className="h-4 w-4" />
                        <span>Choose File</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Side: Options & Actions */}
              <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="space-y-6">
                  {/* Check Type */}
                  <div className="space-y-3">
                    <label className="text-sm font-semibold text-slate-900">Check Type</label>
                    <div className="grid grid-cols-2 gap-3">
                      <label
                        className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-5 text-center transition-all ${
                          checkType === "Received"
                            ? "border-indigo-600 bg-indigo-50/50 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="checkType"
                          value="Received"
                          checked={checkType === "Received"}
                          onChange={() => setCheckType("Received")}
                          className="sr-only"
                        />
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                            checkType === "Received" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          <ArrowDown className="h-5 w-5" />
                        </div>
                        <span
                          className={`text-sm font-semibold ${
                            checkType === "Received" ? "text-slate-900" : "text-slate-600"
                          }`}
                        >
                          Received
                        </span>
                        <span
                          className={`mt-1 h-2.5 w-2.5 rounded-full border-2 ${
                            checkType === "Received" ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"
                          }`}
                        />
                      </label>

                      <label
                        className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-5 text-center transition-all ${
                          checkType === "Sent Out"
                            ? "border-indigo-600 bg-indigo-50/50 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="checkType"
                          value="Sent Out"
                          checked={checkType === "Sent Out"}
                          onChange={() => setCheckType("Sent Out")}
                          className="sr-only"
                        />
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                            checkType === "Sent Out" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          <ArrowUp className="h-5 w-5" />
                        </div>
                        <span
                          className={`text-sm font-semibold ${
                            checkType === "Sent Out" ? "text-slate-900" : "text-slate-600"
                          }`}
                        >
                          Sent Out
                        </span>
                        <span
                          className={`mt-1 h-2.5 w-2.5 rounded-full border-2 ${
                            checkType === "Sent Out" ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"
                          }`}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="border-t border-slate-100" />

                  {/* Checklist Instructions */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-900">What we&apos;ll extract</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                          <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-medium text-slate-600 truncate">Check Number &amp; Date</span>
                        </div>
                        <span className="h-2 w-16 shrink-0 rounded-full bg-slate-200" />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                          <DollarSign className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-medium text-slate-600 truncate">Amount &amp; Memo</span>
                        </div>
                        <span className="h-2 w-16 shrink-0 rounded-full bg-slate-200" />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                          <User className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-medium text-slate-600 truncate">Payer, Payee, and Bank</span>
                        </div>
                        <span className="h-2 w-16 shrink-0 rounded-full bg-slate-200" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8">
                  <button
                    type="button"
                    disabled={!file}
                    onClick={handleAnalyze}
                    className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold shadow-sm transition-all duration-200 ${
                      file
                        ? "bg-indigo-600 text-white hover:bg-indigo-500 hover:shadow-indigo-100 active:scale-[0.98]"
                        : "bg-slate-100 text-slate-400 cursor-not-allowed"
                    }`}
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Process Check</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Loading State */}
          {step === "loading" && (
            <div className="flex min-h-[450px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="relative flex items-center justify-center">
                {/* Spinner */}
                <div className="h-16 w-16 animate-spin rounded-full border-[3px] border-slate-100 border-t-indigo-600"></div>
                <div className="absolute h-8 w-8 rounded-full bg-indigo-50 flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 text-indigo-600 animate-pulse" />
                </div>
              </div>
              <h3 className="mt-6 text-lg font-bold text-slate-900">Processing Check</h3>
              <p className="mt-1 text-sm text-slate-500 max-w-sm">{loadingText}</p>
              <div className="mt-6 w-full max-w-xs bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-600 h-1.5 rounded-full animate-[loading-bar_1.5s_infinite]"></div>
              </div>
            </div>
          )}

          {/* Step 3: Review Panel */}
          {step === "review" && (
            <div className="grid gap-8 md:grid-cols-2">
              {/* Left Side: Original Image Card */}
              <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Original Document</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    Preview
                  </span>
                </div>
                <div className="flex-1 min-h-[300px] md:min-h-[400px] max-h-[500px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shadow-inner">
                  {previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Uploaded check"
                      className="max-h-[500px] object-contain w-full select-none"
                    />
                  )}
                </div>
              </div>

              {/* Right Side: Form Fields */}
              <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                    <div>
                      <h2 className="text-lg font-bold text-slate-950">Review Details</h2>
                      <p className="text-xs text-slate-500">Edit fields to verify correct values</p>
                    </div>
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>Start Over</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Check Type & Number */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                          Check Type
                        </label>
                        <select
                          value={checkType}
                          onChange={(e) => setCheckType(e.target.value as any)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="Received">Received</option>
                          <option value="Sent Out">Sent Out</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                          Check Number
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                            <Hash className="h-4 w-4" />
                          </span>
                          <input
                            type="text"
                            value={checkNumber}
                            onChange={(e) => setCheckNumber(e.target.value)}
                            placeholder="e.g. 1002"
                            className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Date & Amount */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                          Check Date
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                            <Calendar className="h-4 w-4" />
                          </span>
                          <input
                            type="date"
                            value={checkDate}
                            onChange={(e) => setCheckDate(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                          Amount
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                            <DollarSign className="h-4 w-4" />
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="e.g. 1500.00"
                            className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Payer */}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                        Payer (From)
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                          <User className="h-4 w-4" />
                        </span>
                        <input
                          type="text"
                          value={payer}
                          onChange={(e) => setPayer(e.target.value)}
                          placeholder="Payer name"
                          className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Payee */}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                        Payee (To)
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                          <User className="h-4 w-4" />
                        </span>
                        <input
                          type="text"
                          value={payee}
                          onChange={(e) => setPayee(e.target.value)}
                          placeholder="Payee name"
                          className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Bank Name */}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                        Bank Name
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                          <Building className="h-4 w-4" />
                        </span>
                        <input
                          type="text"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          placeholder="Bank name"
                          className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Memo */}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                        Memo
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                          <FileText className="h-4 w-4" />
                        </span>
                        <input
                          type="text"
                          value={memo}
                          onChange={(e) => setMemo(e.target.value)}
                          placeholder="Memo / Description"
                          className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex gap-4">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 hover:shadow-indigo-100 transition-all active:scale-[0.98]"
                  >
                    <Save className="h-4 w-4" />
                    <span>Save to Lark</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Success State */}
          {step === "success" && (
            <div className="mx-auto max-w-md flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm animate-in zoom-in-95 duration-300">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-50 text-green-600 ring-8 ring-green-50/50">
                <CheckCircle className="h-10 w-10" />
              </div>
              <h2 className="text-2xl font-bold text-slate-950">Successfully Saved</h2>
              <p className="mt-2 text-sm text-slate-500">
                The check details have been extracted and a new record has been created in your Lark Base table. The image was also attached successfully.
              </p>

              <div className="mt-8 w-full space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 border border-slate-100 text-sm">
                  <span className="text-slate-500 font-medium">Check Type</span>
                  <span className="font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 text-xs">
                    {checkType}
                  </span>
                </div>
                {amount && (
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 border border-slate-100 text-sm">
                    <span className="text-slate-500 font-medium">Amount Saved</span>
                    <span className="font-bold text-slate-900">
                      ${parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="mt-8 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-all active:scale-[0.98]"
              >
                Upload Another Check
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 mt-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-400">
          <p>© {new Date().getFullYear()} CheckTracker.</p>
        </div>
      </footer>
    </div>
  );
}
