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

    console.log('🔍 Starting extraction...');

    // Get API key
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      console.error('❌ API key missing');
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Extract base64
    let base64Data;
    if (imageData.includes(',')) {
      base64Data = imageData.split(',')[1];
    } else {
      base64Data = imageData;
    }

    console.log('📸 Calling Vision API...');

    // Call Vision API
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotateRequest?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Data },
              features: [
                { type: 'TEXT_DETECTION' }
              ]
            }
          ]
        })
      }
    );

    console.log('Response status:', visionResponse.status);

    if (!visionResponse.ok) {
      const errorData = await visionResponse.json();
      console.error('Vision API error:', errorData);
      return res.status(visionResponse.status).json({
        error: 'Vision API failed',
        details: errorData
      });
    }

    const visionData = await visionResponse.json();
    const textAnnotations = visionData.responses?.[0]?.textAnnotations || [];
    
    if (!textAnnotations || textAnnotations.length === 0) {
      return res.status(400).json({
        error: 'No text detected in image'
      });
    }

    const fullText = textAnnotations[0].description || '';
    console.log('✅ Text extracted, length:', fullText.length);

    if (!fullText) {
      return res.status(400).json({ error: 'No text found' });
    }

    // Parse the text
    console.log('🔍 Parsing business card...');
    const extracted = parseCard(fullText);

    console.log('✅ Parsing complete');

    return res.status(200).json({
      success: true,
      data: extracted
    });

  } catch (error) {
    console.error('❌ Extraction error:', error.message);
    console.error('Stack:', error.stack);
    return res.status(500).json({
      error: 'Extraction failed',
      details: error.message
    });
  }
}

function parseCard(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const fullText = text.toLowerCase();

  return {
    fullName: extractName(lines, text),
    firstName: '',
    lastName: '',
    designation: extractDesignation(lines, fullText),
    department: extractDepartment(lines, fullText),
    company: extractCompany(lines, text),
    email: extractPrimaryEmail(fullText),
    phone: extractPrimaryPhone(lines, fullText),
    phones: extractAllPhones(lines, fullText),
    address: extractPrimaryAddress(lines, fullText),
    addresses: extractAllAddresses(lines, fullText),
    website: extractWebsite(fullText),
    fax: extractFax(fullText),
    notes: '',
    extractionConfidence: 0.85
  };
}

function extractName(lines, text) {
  // Look for capitalized names
  for (let line of lines) {
    if (line.length < 5 || line.length > 50) continue;
    if (line.includes('http') || line.includes('@')) continue;
    
    // Pattern: First Last (two capitalized words)
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line)) {
      return line;
    }
  }
  return '';
}

function extractDesignation(lines, fullText) {
  const keywords = ['manager', 'director', 'engineer', 'officer', 'ceo', 'cto', 'president', 'supervisor', 'specialist', 'consultant', 'developer', 'architect', 'lead', 'head', 'chief'];
  
  for (let line of lines) {
    const lower = line.toLowerCase();
    for (let kw of keywords) {
      if (lower.includes(kw)) return line;
    }
  }
  return '';
}

function extractDepartment(lines, fullText) {
  const keywords = ['sales', 'marketing', 'engineering', 'operations', 'finance', 'hr', 'it', 'support', 'legal', 'production'];
  
  for (let line of lines) {
    const lower = line.toLowerCase();
    for (let kw of keywords) {
      if (lower.includes(kw)) return line;
    }
  }
  return '';
}

function extractCompany(lines, text) {
  // Company usually at top and capitalized
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const line = lines[i];
    if (line.length > 4 && line.length < 80 && !line.includes('http') && !line.includes('@')) {
      if (/^[A-Z][\w\s.,&\-()]+$/.test(line)) {
        return line;
      }
    }
  }
  return '';
}

function extractPrimaryEmail(fullText) {
  const emails = extractEmails(fullText);
  return emails[0] || '';
}

function extractEmails(fullText) {
  const regex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const matches = fullText.match(regex) || [];
  return [...new Set(matches.map(e => e.toLowerCase()))];
}

function extractPrimaryPhone(lines, fullText) {
  const phones = extractAllPhones(lines, fullText);
  return phones.mobile || phones.office || phones.other?.[0] || '';
}

function extractAllPhones(lines, fullText) {
  const result = {
    mobile: '',
    office: '',
    factory: '',
    other: []
  };

  const phoneRegex = /(?:(?:mob|mobile|cell|whatsapp)[\s:.\-]*)?(\+?[\d\s().\-]{10,})|(?:(?:tel|phone|office|desk)[\s:.\-]*)(\+?[\d\s().\-]{10,})|(?:factory[\s:.\-]*)(\+?[\d\s().\-]{10,})/gi;
  
  for (let line of lines) {
    const lower = line.toLowerCase();
    
    // Extract phone numbers
    const digitMatch = line.match(/[\d\s().\-+]{10,}/);
    if (!digitMatch) continue;
    
    const phoneNum = digitMatch[0].replace(/[^0-9+\-()]/g, '').trim();
    if (phoneNum.replace(/\D/g, '').length < 8) continue;

    if (lower.includes('mob') || lower.includes('cell') || lower.includes('whatsapp')) {
      if (!result.mobile) result.mobile = phoneNum;
    } else if (lower.includes('factory') || lower.includes('plant')) {
      if (!result.factory) result.factory = phoneNum;
    } else if (lower.includes('office') || lower.includes('desk') || lower.includes('tel')) {
      if (!result.office) result.office = phoneNum;
    } else if (phoneNum) {
      if (!result.other.includes(phoneNum)) result.other.push(phoneNum);
    }
  }

  // Clean up
  if (!result.mobile) delete result.mobile;
  if (!result.office) delete result.office;
  if (!result.factory) delete result.factory;
  result.other = result.other.slice(0, 3);

  return result;
}

function extractPrimaryAddress(lines, fullText) {
  const addresses = extractAllAddresses(lines, fullText);
  return addresses.office || addresses.factory || addresses.other?.[0] || '';
}

function extractAllAddresses(lines, fullText) {
  const result = {
    office: '',
    factory: '',
    other: []
  };

  let addrLines = [];
  let inAddr = false;

  for (let line of lines) {
    const lower = line.toLowerCase();

    if (line.match(/^\d+/) || lower.includes('road') || lower.includes('street') || lower.includes('avenue') || lower.includes('building')) {
      inAddr = true;
    }

    if (inAddr) {
      addrLines.push(line);

      if (line.match(/\d{5,}/) || lower.includes('postal') || line.match(/tel|phone/i)) {
        inAddr = false;
        
        if (addrLines.length > 0) {
          const addr = addrLines.join(' ').trim();
          if (lower.includes('factory')) {
            result.factory = addr;
          } else if (!result.office) {
            result.office = addr;
          } else {
            result.other.push(addr);
          }
          addrLines = [];
        }
      }
    }
  }

  if (!result.office) delete result.office;
  if (!result.factory) delete result.factory;
  result.other = result.other.slice(0, 2);

  return result;
}

function extractWebsite(fullText) {
  const regex = /(https?:\/\/|www\.)[^\s]+/gi;
  const matches = fullText.match(regex) || [];
  return matches[0] || '';
}

function extractFax(fullText) {
  const regex = /(?:fax|f)[\s:.\-]*(\+?[\d\s().\-]{10,})/gi;
  const match = regex.exec(fullText);
  if (match) {
    return match[1].replace(/[^0-9+\-()]/g, '').trim();
  }
  return '';
}
