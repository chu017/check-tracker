import { NextRequest, NextResponse } from "next/server";

interface SaveCheckRequest {
  checkType: "Received" | "Sent Out";
  checkNumber: string | null;
  checkDate: string | null; // YYYY-MM-DD
  amount: number | null;
  payer: string | null;
  payee: string | null;
  bankName: string | null;
  memo: string | null;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Validate Environment Variables
    const appId = process.env.LARK_APP_ID;
    const appSecret = process.env.LARK_APP_SECRET;
    const baseAppToken = process.env.LARK_BASE_APP_TOKEN;
    const tableId = process.env.LARK_TABLE_ID;

    if (!appId || !appSecret || !baseAppToken || !tableId) {
      return NextResponse.json(
        { error: "Lark credentials or base configuration are missing on the server-side." },
        { status: 500 }
      );
    }

    // 2. Parse request multipart form-data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const dataStr = formData.get("data") as string | null;

    if (!file || !dataStr) {
      return NextResponse.json(
        { error: "Missing file or check data in request form-data." },
        { status: 400 }
      );
    }

    const data: SaveCheckRequest = JSON.parse(dataStr);

    // 3. Get Lark tenant_access_token
    const tokenResponse = await fetch(
      "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Lark authentication failed: ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    if (tokenData.code !== 0) {
      throw new Error(`Lark authentication returned code ${tokenData.code}: ${tokenData.msg}`);
    }

    const tenantAccessToken = tokenData.tenant_access_token;

    // 4. Upload file to Lark Drive (medias/upload_all)
    const fileBytes = await file.arrayBuffer();
    const fileBlob = new Blob([fileBytes], { type: file.type });

    const uploadFormData = new FormData();
    uploadFormData.append("file_name", file.name);
    uploadFormData.append("parent_type", "bitable_file");
    uploadFormData.append("parent_node", baseAppToken);
    uploadFormData.append("size", String(file.size));
    uploadFormData.append("file", fileBlob, file.name);

    // Do NOT set Content-Type header manually when sending FormData, fetch will set boundary automatically
    const uploadResponse = await fetch(
      "https://open.larksuite.com/open-apis/drive/v1/medias/upload_all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
        },
        body: uploadFormData,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Lark media upload failed: ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    if (uploadData.code !== 0) {
      throw new Error(`Lark media upload returned code ${uploadData.code}: ${uploadData.msg}`);
    }

    const fileToken = uploadData.data.file_token;

    // 5. Parse date to Unix milliseconds timestamp
    let checkDateTimestamp: number | null = null;
    if (data.checkDate) {
      const parsedDate = new Date(data.checkDate);
      if (!isNaN(parsedDate.getTime())) {
        checkDateTimestamp = parsedDate.getTime();
      }
    }

    // 6. Create record in Lark Bitable (Base)
    const recordPayload = {
      fields: {
        "Check Image": [
          {
            file_token: fileToken,
          },
        ],
        "Check Type": data.checkType,
        "Check Number": data.checkNumber || null,
        "Check Date": checkDateTimestamp,
        "Amount": data.amount !== null ? data.amount : null,
        "Payer": data.payer || null,
        "Payee": data.payee || null,
        "Bank Name": data.bankName || null,
        "Memo": data.memo || null,
      },
    };

    const createRecordResponse = await fetch(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseAppToken}/tables/${tableId}/records`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tenantAccessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(recordPayload),
      }
    );

    if (!createRecordResponse.ok) {
      const errorText = await createRecordResponse.text();
      throw new Error(`Lark Bitable record creation failed: ${errorText}`);
    }

    const createRecordData = await createRecordResponse.json();
    if (createRecordData.code !== 0) {
      throw new Error(
        `Lark Bitable record creation returned code ${createRecordData.code}: ${createRecordData.msg}`
      );
    }

    return NextResponse.json({
      success: true,
      recordId: createRecordData.data?.record?.record_id || null,
    });
  } catch (error: any) {
    console.error("Error in save-check endpoint:", error);
    return NextResponse.json(
      { error: error.message || "An error occurred while saving the check data." },
      { status: 500 }
    );
  }
}
