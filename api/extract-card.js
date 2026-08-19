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

    console.log("📸 Extracting business card with Vision API...");

    const base64Data = imageData.split(",")[1] || imageData;
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "API key not configured" });
    }

    // Call Google Vision API
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotateRequest?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Data },
              features: [
                { type: "TEXT_DETECTION" },
                { type: "LOGO_DETECTION" },
                { type: "LABEL_DETECTION" },
              ],
            },
          ],
        }),
      }
    );

    if (!visionResponse.ok) {
      const error = await visionResponse.json();
      console.error("Vision API error:", error);
      return res.status(400).json({
        error: "Vision API failed",
        details: error,
      });
    }

    const visionData = await visionResponse.json();
    const textAnnotation = visionData.responses?.[0]?.textAnnotations || [];
    const fullText = textAnnotation[0]?.description || "";

    console.log("📄 Extracted text (first 300 chars):", fullText.substring(0, 300));

    if (!fullText) {
      return res.status(400).json({
        error: "No text found in image",
      });
    }

    // Parse with smart regex
    const extracted = parseBusinessCard(fullText);

    console.log("✅ Extraction successful");

    return res.status(200).json({
      success: true,
      data: extracted,
      rawText: fullText,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({
      error: "Failed to extract card",
      details: error.message,
    });
  }
}

function parseBusinessCard(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l);
  const fullText = text.toLowerCase();

  const extracted = {
    fullName: extractName(lines, text),
    firstName: "",
    lastName: "",
    designation: extractDesignation(lines, fullText),
    department: extractDepartment(lines, fullText),
    company: extractCompany(lines, text),
    emails: extractEmails(fullText),
    phones: extractPhones(lines, fullText),
    addresses: extractAddresses(lines, fullText),
    website: extractWebsite(fullText),
    fax: extractFax(fullText),
    socialMedia: extractSocialMedia(fullText),
    qrCode: fullText.includes("qr") ? "yes" : "unknown",
    logo: "unknown",
    additionalInfo: "",
    languages: ["en"],
    extractionConfidence: 0.85,
  };

  // Split name
  if (extracted.fullName) {
    const parts = extracted.fullName.split(/\s+/);
    extracted.firstName = parts[0] || "";
    extracted.lastName = parts.slice(1).join(" ") || "";
  }

  return extracted;
}

function extractName(lines, text) {
  // Look for capitalized names not in parentheses
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip short lines or URLs
    if (line.length < 5 || line.includes("http") || line.includes("@")) {
      continue;
    }

    // Look for pattern: First Last or First Middle Last
    if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(line)) {
      return line;
    }
  }

  return "";
}

function extractDesignation(lines, fullText) {
  const keywords = [
    "ceo",
    "cto",
    "cfo",
    "president",
    "vice president",
    "director",
    "manager",
    "engineer",
    "officer",
    "executive",
    "supervisor",
    "coordinator",
    "specialist",
    "consultant",
    "analyst",
    "developer",
    "architect",
    "lead",
    "head",
    "chief",
    "assistant manager",
    "technical lead",
  ];

  for (let line of lines) {
    const lower = line.toLowerCase();
    for (let kw of keywords) {
      if (lower.includes(kw)) {
        return line;
      }
    }
  }

  return "";
}

function extractDepartment(lines, fullText) {
  const keywords = [
    "sales",
    "marketing",
    "engineering",
    "operations",
    "finance",
    "hr",
    "human resources",
    "it",
    "support",
    "legal",
    "production",
    "quality",
  ];

  for (let line of lines) {
    const lower = line.toLowerCase();
    for (let kw of keywords) {
      if (lower.includes(kw)) {
        return line;
      }
    }
  }

  return "";
}

function extractCompany(lines, text) {
  // Company is usually all caps or title case at top
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i];

    if (line.length < 5 || line.length > 80) continue;
    if (line.includes("http") || line.includes("@")) continue;

    // All caps company name
    if (/^[A-Z\s&.,\-()]+$/.test(line) && line.length > 5) {
      return line;
    }
  }

  return "";
}

function extractEmails(fullText) {
  const regex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const emails = fullText.match(regex) || [];
  return [...new Set(emails.map((e) => e.toLowerCase()))];
}

function extractPhones(lines, fullText) {
  const phones = {
    mobile: "",
    office: "",
    factory: "",
    other: [],
  };

  // Extended phone patterns
  const patterns = [
    { regex: /(?:mob|mobile|whatsapp|cell)[\s:.\-]*([\d\s().\-+]+)/gi, type: "mobile" },
    { regex: /(?:office|desk|direct|tel|t|o)[\s:.\-]*([\d\s().\-+]+)/gi, type: "office" },
    { regex: /(?:fax|f)[\s:.\-]*([\d\s().\-+]+)/gi, type: "fax" },
    { regex: /(?:factory|plant|production)[\s:.\-]*([\d\s().\-+]+)/gi, type: "factory" },
  ];

  // Also look for standalone phone numbers
  const phoneRegex = /(?:^|\s)(?:\+?[\d\s().\-]{10,20})/gm;
  const matches = fullText.matchAll(phoneRegex);

  for (let match of matches) {
    const number = cleanPhoneNumber(match[0]);
    if (number && !phones.other.includes(number)) {
      phones.other.push(number);
    }
  }

  // Look for labeled phones
  for (let pattern of patterns) {
    const matches = fullText.matchAll(pattern.regex);
    for (let match of matches) {
      const number = cleanPhoneNumber(match[1]);
      if (!number) continue;

      if (pattern.type === "mobile" && !phones.mobile) {
        phones.mobile = number;
      } else if (pattern.type === "office" && !phones.office) {
        phones.office = number;
      } else if (pattern.type === "factory" && !phones.factory) {
        phones.factory = number;
      } else if (pattern.type !== "fax" && !phones.other.includes(number)) {
        phones.other.push(number);
      }
    }
  }

  // Remove empty fields
  if (!phones.mobile) delete phones.mobile;
  if (!phones.office) delete phones.office;
  if (!phones.factory) delete phones.factory;
  phones.other = [...new Set(phones.other)].slice(0, 5); // Limit to 5

  return phones;
}

function cleanPhoneNumber(str) {
  if (!str) return "";
  const cleaned = str.replace(/[^0-9+\-() ]/g, "").trim();
  // Must have at least 8 digits
  const digitCount = (cleaned.match(/\d/g) || []).length;
  return digitCount >= 8 ? cleaned : "";
}

function extractAddresses(lines, fullText) {
  const addresses = {
    office: "",
    factory: "",
    other: [],
  };

  const addressLines = [];
  let inAddress = false;

  for (let line of lines) {
    const lower = line.toLowerCase();

    // Start address detection
    if (line.match(/^\d+\s/) || lower.match(/road|street|avenue|lane|building|block|suite/)) {
      inAddress = true;
    }

    if (inAddress) {
      addressLines.push(line);

      // End at postal code or phone or next name
      if (line.match(/\d{5,}/) || lower.match(/post\s*code|zip|postal/) || line.match(/tel|phone/i)) {
        inAddress = false;

        if (addressLines.length > 0) {
          const addr = addressLines.join(" ").trim();
          if (lower.includes("factory") || lower.includes("plant")) {
            addresses.factory = addr;
          } else if (!addresses.office) {
            addresses.office = addr;
          } else {
            addresses.other.push(addr);
          }
          addressLines.length = 0;
        }
      }
    }
  }

  // Remove empty
  if (!addresses.office) delete addresses.office;
  if (!addresses.factory) delete addresses.factory;

  return addresses;
}

function extractWebsite(fullText) {
  const regex = /(https?:\/\/|www\.)[^\s]+/gi;
  const urls = fullText.match(regex) || [];
  return urls[0] || "";
}

function extractFax(fullText) {
  const regex = /(?:fax|f)[\s:.\-]*([\d\s().\-+]+)/gi;
  const match = fullText.match(regex);
  if (match) {
    return cleanPhoneNumber(match[0]);
  }
  return "";
}

function extractSocialMedia(fullText) {
  const social = {};

  const linkedin = fullText.match(/linkedin\.com\/in\/[\w\-]+/i);
  if (linkedin) social.linkedin = linkedin[0];

  const twitter = fullText.match(/@[\w]+/);
  if (twitter) social.twitter = twitter[0];

  const wechat = fullText.match(/wechat[\s:]*[\w\-]+/i);
  if (wechat) social.wechat = wechat[0];

  return social;
}
