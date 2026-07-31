# CheckTracker

An internal financial web application MVP built to process paper checks. Users upload check images, choose whether they are received or sent out, use Gemini Vision AI to extract key financial parameters, review the values side-by-side, and save them directly (along with the image attachment) to a Lark Base instance.

## Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **AI Extraction:** Google Gemini Vision (`gemini-1.5-flash` model)
- **Database & Storage:** Lark Base (Bitable) & Lark Drive

---

## Getting Started

### 1. Prerequisites
Ensure you have Node.js (version 18+ or 20+) installed on your machine.

### 2. Configure Lark Base (Bitable)
Before running the application, make sure your Lark Bitable has a table with the following fields configured:

| Field Name | Type | Options / Configuration Details |
| :--- | :--- | :--- |
| **Check Image** | Attachment | Used to store the uploaded image file |
| **Check Type** | Single Select | Options: `Received`, `Sent Out` |
| **Check Number** | Text | String field for check index |
| **Check Date** | Date | Configured to display dates (e.g. `YYYY-MM-DD`) |
| **Amount** | Currency | Numeric field formatted to two decimals (USD) |
| **Payer** | Text | The entity paying the check |
| **Payee** | Text | The entity receiving the check |
| **Bank Name** | Text | The bank name listed on the check |
| **Memo** | Text | The description/memo line of the check |
| **Created Time** | Created Time | Automatically populated by Lark on record creation |

### 3. Environment Variables Setup
1. Copy the environment template:
   ```bash
   cp .env.example .env.local
   ```
2. Fill in the keys in `.env.local`:
   ```env
   # Google Gemini API
   GEMINI_API_KEY=your_gemini_api_key

   # Lark API Integration
   LARK_APP_ID=your_lark_app_id
   LARK_APP_SECRET=your_lark_app_secret
   LARK_BASE_APP_TOKEN=your_lark_base_app_token
   LARK_TABLE_ID=your_lark_table_id
   ```

### 4. Running the Development Server
Install dependencies and run the local server:
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to start tracking checks.

### 5. Production Build
Verify the production compilation:
```bash
npm run build
```
This runs TypeScript checking, ESLint static analysis, and constructs an optimized static/dynamic production bundle.
