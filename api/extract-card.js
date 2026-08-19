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
      return res.status(400).json({ error: 'No image data' });
    }

    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key missing' });
    }

    const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotateRequest?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Data },
              features: [{ type: 'TEXT_DETECTION' }]
            }
          ]
        })
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Vision API failed' });
    }

    const data = await response.json();
    const text = data.responses?.[0]?.textAnnotations?.[0]?.description || '';

    if (!text) {
      return res.status(400).json({ error: 'No text found' });
    }

    // Parse with intelligent extraction
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const lowerText = text.toLowerCase();

    // Extract fields
    let fullName = '';
    let designation = '';
    let company = '';
    let email = '';
    let phones = [];
    let address = '';

    // Extract name (capitalized words at top)
    for (let line of lines.slice(0, 3)) {
      if (/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line) && line.length < 50) {
        fullName = line;
        break;
      }
    }

    // Extract designation (common job titles)
    for (let line of lines) {
      const l = line.toLowerCase();
      if (l.includes('manager') || l.includes('director') || l.includes('engineer') || 
          l.includes('officer') || l.includes('ceo') || l.includes('cto') ||
          l.includes('president') || l.includes('supervisor')) {
        designation = line;
        break;
      }
    }

    // Extract company (capitalized, not a title, not too long)
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      const line = lines[i];
      if (line.length > 5 && line.length < 80 && /^[A-Z][\w\s.,&\-()]+$/.test(line) && 
          !line.includes('http') && !line.includes('@') && line !== fullName && line !== designation) {
        company = line;
        break;
      }
    }

    // Extract emails
    const emailMatches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    email = emailMatches[0] || '';

    // Extract phone numbers (all occurrences)
    const phoneRegex = /[\d\s().\-+]{8,}/g;
    for (let line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes('tel') || lower.includes('phone') || lower.includes('mob') || 
          lower.includes('office') || lower.includes('desk')) {
        const phoneMatch = line.match(/[\d\s().\-+]{8,}/);
        if (phoneMatch) {
          phones.push(phoneMatch[0].trim());
        }
      }
    }

    // Extract address (lines with street, building, road, etc.)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      if (line.match(/^\d+/) || lower.includes('road') || lower.includes('street') || 
          lower.includes('building') || lower.includes('avenue')) {
        address = line;
        break;
      }
    }

    // Extract website
    const websiteMatch = text.match(/(https?:\/\/|www\.)[^\s]+/i);
    const website = websiteMatch ? websiteMatch[0] : '';

    return res.status(200).json({
      success: true,
      data: {
        fullName,
        firstName: fullName.split(' ')[0] || '',
        lastName: fullName.split(' ').slice(1).join(' ') || '',
        designation,
        company,
        email,
        phone: phones[0] || '',
        phones: {
          mobile: phones[0] || '',
          office: phones[1] || '',
          other: phones.slice(2)
        },
        address,
        website,
        notes: '',
        extractionConfidence: 0.85
      }
    });

  } catch (error) {
    return res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  }
}
