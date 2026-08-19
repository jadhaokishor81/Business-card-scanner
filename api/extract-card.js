import Tesseract from 'tesseract.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    console.log('🔍 Extracting text with Tesseract OCR...');

    // Convert base64 to buffer
    const base64Data = imageData.split(',')[1] || imageData;
    const buffer = Buffer.from(base64Data, 'base64');

    // Run Tesseract OCR
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
      logger: (m) => console.log('Tesseract:', m.status, m.progress)
    });

    console.log('📄 Extracted text:', text.substring(0, 200) + '...');

    // Parse extracted text
    const extracted = parseBusinessCard(text);

    console.log('✅ Parsing complete');

    return res.status(200).json({
      success: true,
      data: extracted,
      rawText: text
    });

  } catch (error) {
    console.error('❌ Error extracting card:', error.message);
    return res.status(500).json({
      error: 'Failed to extract business card',
      details: error.message
    });
  }
}

function parseBusinessCard(text) {
  // Clean up text
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const fullText = text.toLowerCase();

  // Extract data
  const extracted = {
    fullName: extractName(lines, fullText),
    firstName: '',
    lastName: '',
    designation: extractDesignation(lines, fullText),
    department: extractDepartment(lines, fullText),
    company: extractCompany(lines, fullText),
    emails: extractEmails(fullText),
    phones: extractPhones(lines, fullText),
    addresses: extractAddresses(lines, fullText),
    website: extractWebsite(fullText),
    fax: extractFax(fullText),
    socialMedia: extractSocialMedia(fullText),
    qrCode: detectQRCode(text),
    logo: 'unknown',
    additionalInfo: '',
    languages: ['en'],
    extractionConfidence: 0.85
  };

  // Split name
  if (extracted.fullName) {
    const nameParts = extracted.fullName.split(/\s+/);
    extracted.firstName = nameParts[0] || '';
    extracted.lastName = nameParts.slice(1).join(' ') || '';
  }

  return extracted;
}

function extractName(lines, fullText) {
  // Look for names after title keywords or at start of card
  const titleKeywords = ['manager', 'director', 'engineer', 'officer', 'executive', 'ceo', 'cto', 'cfo'];
  
  for (let line of lines) {
    const lower = line.toLowerCase();
    
    // Skip company lines
    if (lower.includes('limited') || lower.includes('corp') || lower.includes('inc.') || lower.length > 60) {
      continue;
    }
    
    // Look for name patterns
    if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(line)) {
      return line;
    }
  }

  // Fallback: first two capitalized words
  const match = fullText.match(/([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
  return match ? `${match[1]} ${match[2]}` : '';
}

function extractDesignation(lines, fullText) {
  const designationKeywords = [
    'manager', 'director', 'engineer', 'officer', 'executive', 'ceo', 'cto', 'cfo',
    'president', 'vice president', 'manager', 'supervisor', 'coordinator', 'specialist',
    'consultant', 'analyst', 'developer', 'architect', 'lead', 'head', 'chief', 'assistant'
  ];

  for (let line of lines) {
    const lower = line.toLowerCase();
    for (let keyword of designationKeywords) {
      if (lower.includes(keyword)) {
        return line;
      }
    }
  }

  return '';
}

function extractDepartment(lines, fullText) {
  const deptKeywords = ['sales', 'marketing', 'engineering', 'hr', 'finance', 'operations', 'support', 'it', 'legal'];
  
  for (let line of lines) {
    const lower = line.toLowerCase();
    for (let keyword of deptKeywords) {
      if (lower.includes(keyword)) {
        return line;
      }
    }
  }

  return '';
}

function extractCompany(lines, fullText) {
  // Company is usually capitalized and on top of card or after logo
  for (let line of lines) {
    // Skip very short lines
    if (line.length < 3 || line.length > 80) continue;
    
    // Look for capitalized company names
    if (/^[A-Z][\w\s.,&-]+$/.test(line) && !line.includes('http')) {
      // Skip if looks like address
      if (!line.match(/\d+\s+[A-Z]/)) {
        return line;
      }
    }
  }

  return '';
}

function extractEmails(fullText) {
  const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const emails = fullText.match(emailRegex) || [];
  return [...new Set(emails.map(e => e.toLowerCase()))];
}

function extractPhones(lines, fullText) {
  const phones = {
    mobile: '',
    office: '',
    factory: '',
    other: []
  };

  const phoneRegex = /(?:tel|phone|mob|fax|t|p|f|m)[\s:.-]*(?:\+?[\d\s\-()]{10,20})/gi;
  const matches = fullText.matchAll(phoneRegex);

  for (let match of matches) {
    const text = match[0].toLowerCase();
    const number = text.replace(/[^0-9+\-()]/g, '').trim();

    if (!number) continue;

    if (text.includes('mob') || text.includes('cell') || text.includes('whatsapp')) {
      phones.mobile = number;
    } else if (text.includes('fax')) {
      phones.fax = number;
    } else if (text.includes('factory') || text.includes('plant')) {
      phones.factory = number;
    } else if (text.includes('office') || text.includes('desk') || text.match(/^[pt][\s:.-]/)) {
      if (!phones.office) phones.office = number;
      else phones.other.push(number);
    } else {
      phones.other.push(number);
    }
  }

  // Clean up
  if (!phones.mobile) delete phones.mobile;
  if (!phones.office) delete phones.office;
  if (!phones.factory) delete phones.factory;
  phones.other = [...new Set(phones.other)];

  return phones;
}

function extractAddresses(lines, fullText) {
  const addresses = {
    office: '',
    factory: '',
    other: []
  };

  let addressLines = [];
  let inAddress = false;

  for (let line of lines) {
    // Detect address patterns
    if (line.match(/^\d+/) || line.match(/road|street|avenue|lane|building|block|suite|floor/i)) {
      inAddress = true;
    }

    if (inAddress) {
      addressLines.push(line);
      
      // End address at postal code or phone
      if (line.match(/\d{5,}/) || line.match(/post code|zip|postal/i) || line.match(/tel|phone/i)) {
        inAddress = false;
        
        if (addressLines.length > 0) {
          const addr = addressLines.join(' ').trim();
          
          if (fullText.includes('factory') || fullText.includes('plant')) {
            addresses.factory = addr;
          } else {
            addresses.office = addr;
          }
          
          addressLines = [];
        }
      }
    }
  }

  // Clean up
  if (!addresses.office) delete addresses.office;
  if (!addresses.factory) delete addresses.factory;

  return addresses;
}

function extractWebsite(fullText) {
  const urlRegex = /(https?:\/\/|www\.)[^\s]+/gi;
  const urls = fullText.match(urlRegex) || [];
  return urls[0] || '';
}

function extractFax(fullText) {
  const faxRegex = /(?:fax|f)[\s:.-]*(?:\+?[\d\s\-()]{10,20})/gi;
  const match = fullText.match(faxRegex);
  if (match) {
    return match[0].replace(/[^0-9+\-()]/g, '').trim();
  }
  return '';
}

function extractSocialMedia(fullText) {
  const social = {};

  // LinkedIn
  const linkedinMatch = fullText.match(/linkedin\.com\/in\/[\w-]+/i);
  if (linkedinMatch) social.linkedin = linkedinMatch[0];

  // Twitter
  const twitterMatch = fullText.match(/@[\w]+/);
  if (twitterMatch) social.twitter = twitterMatch[0];

  // WeChat
  const wechatMatch = fullText.match(/wechat[\s:]*[\w-]+/i);
  if (wechatMatch) social.wechat = wechatMatch[0];

  return social;
}

function detectQRCode(text) {
  // Simple QR detection: QR codes often have specific patterns in OCR
  if (text.includes('QR') || text.match(/[A-Z0-9]{50,}/)) {
    return 'yes';
  }
  return 'unknown';
}
