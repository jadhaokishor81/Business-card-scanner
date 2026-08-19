import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: "No image data provided" });
    }

    console.log("Extracting business card data with enhanced parsing...");

    // Use Claude to intelligently extract ALL business card data
    const base64Data = imageData.split(",")[1] || imageData;

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Data,
              },
            },
            {
              type: "text",
              text: `Extract ALL business card information. Be thorough and extract EVERYTHING visible.

Return ONLY a valid JSON object (no markdown, no code blocks, just raw JSON) with this structure:
{
  "fullName": "Complete person name or null",
  "firstName": "First name or null",
  "lastName": "Last name or null",
  "designation": "Job title/position or null",
  "department": "Department if visible or null",
  "company": "Company name or null",
  "emails": ["email1@company.com", "email2@company.com"],
  "phones": {
    "mobile": "mobile number or null",
    "office": "office/desk number or null",
    "factory": "factory number or null",
    "other": ["other numbers"]
  },
  "addresses": {
    "office": "office full address or null",
    "factory": "factory/plant address or null",
    "other": ["other addresses"]
  },
  "website": "website URL or null",
  "fax": "fax number or null",
  "socialMedia": {
    "linkedin": "linkedin URL or null",
    "twitter": "twitter handle or null",
    "other": {"platform": "handle/url"}
  },
  "qrCode": "QR code detected (yes/no/unknown)",
  "logo": "Company logo present (yes/no/unknown)",
  "additionalInfo": "Any other important information",
  "languages": ["language codes detected"],
  "extractionConfidence": 0.95
}

IMPORTANT:
- Extract EXACTLY as written on the card
- For multiple numbers/addresses, list ALL of them
- Handle multi-line addresses properly
- Detect QR codes visually
- Detect company logos
- Return null for fields that are NOT visible
- Return empty arrays for optional repeating fields if none found
- Set extractionConfidence 0-1 based on how clear the card is`,
            },
          ],
        },
      ],
    });

    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent) {
      return res.status(500).json({ error: "No text response from Claude" });
    }

    let extractedData;
    try {
      extractedData = JSON.parse(textContent.text);
    } catch (e) {
      console.error("JSON parse error:", e.message);
      console.error("Raw response:", textContent.text);
      return res.status(500).json({
        error: "Failed to parse extraction response",
        details: e.message,
      });
    }

    console.log("✅ Extraction successful:", extractedData);

    // Format for frontend (with mandatory fields)
    const formattedData = {
      fullName: extractedData.fullName || "",
      firstName: extractedData.firstName || "",
      lastName: extractedData.lastName || "",
      designation: extractedData.designation || "",
      department: extractedData.department || "",
      company: extractedData.company || "",
      email: extractedData.emails?.[0] || "", // Primary email for form
      alternateEmails: extractedData.emails?.slice(1) || [],
      phone: extractedData.phones?.mobile || extractedData.phones?.office || "", // Primary phone for form
      phones: extractedData.phones || {},
      address: extractedData.addresses?.office || "", // Primary address for form
      addresses: extractedData.addresses || {},
      website: extractedData.website || "",
      fax: extractedData.fax || "",
      socialMedia: extractedData.socialMedia || {},
      qrCode: extractedData.qrCode || "unknown",
      logo: extractedData.logo || "unknown",
      additionalInfo: extractedData.additionalInfo || "",
      languages: extractedData.languages || [],
      extractionConfidence: extractedData.extractionConfidence || 0.5,

      // Raw extracted data for Google Sheets
      rawData: extractedData,
    };

    return res.status(200).json({
      success: true,
      data: formattedData,
    });
  } catch (error) {
    console.error("Error extracting card:", error.message);
    return res.status(500).json({
      error: "Failed to extract business card",
      details: error.message,
    });
  }
}
