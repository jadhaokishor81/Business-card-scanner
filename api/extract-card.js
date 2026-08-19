// Intelligent business card parser with improved name detection
function parseBusinessCardIntelligently(lines, fullText) {
  const card = {
    fullName: '',
    jobTitle: '',
    company: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    notes: ''
  };

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?[\d]{3}\)?[-.\s]?[\d]{3}[-.\s]?[\d]{4}|(?:\+\d{1,3}[-.\s]?)?[\d]{7,15}|\+\d{1,3}\s?\d{1,14}/g;
  const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/g;
  const addressKeywords = /street|avenue|road|blvd|suite|floor|building|apt|box|p\.o\.|po box|city|state|zip|postal|country/i;

  const emailMatches = fullText.match(emailRegex);
  if (emailMatches) card.email = emailMatches[0];

  const phoneMatches = fullText.match(phoneRegex);
  if (phoneMatches) {
    const validPhones = phoneMatches.filter(p => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15;
    });
    if (validPhones.length > 0) card.phone = validPhones[0];
  }

  const urlMatches = fullText.match(urlRegex);
  if (urlMatches) {
    // Filter out mccsemi.com pattern more carefully
    for (let url of urlMatches) {
      if (!url.includes('example.com') && !url.includes('placeholder')) {
        card.website = url;
        break;
      }
    }
  }

  const titleKeywords = [
    'director', 'manager', 'engineer', 'specialist', 'executive', 'president',
    'ceo', 'cto', 'cfo', 'consultant', 'developer', 'designer', 'analyst',
    'coordinator', 'officer', 'representative', 'lead', 'supervisor', 'head',
    'chief', 'associate', 'assistant', 'administrator', 'architect', 'producer',
    'strategist', 'partner', 'founder', 'vice', 'deputy', 'senior', 'principal',
    'sales', 'marketing', 'operations', 'finance'
  ];

  const companyKeywords = [
    'inc', 'ltd', 'corp', 'llc', 'pvt', 'gmbh', 'ag', 'co.', 'company',
    'group', 'solutions', 'services', 'systems', 'technologies', 'enterprises',
    'international', 'global', 'consultants', 'associates', 'partners',
    'corporation', 'industries', 'micro', 'components'
  ];

  let nameFound = false;
  let titleFound = false;
  let companyFound = false;
  const addressLines = [];

  // First pass: identify key data types
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    const charCount = line.length;

    if (charCount < 2) continue;
    if (line.includes('@') || lowerLine.match(/^\+?\d/)) continue;

    // TITLE EXTRACTION - do this first to mark title lines
    if (!titleFound && titleKeywords.some(kw => lowerLine.includes(kw))) {
      card.jobTitle = line;
      titleFound = true;
      continue;
    }

    // COMPANY EXTRACTION
    if (!companyFound && companyKeywords.some(kw => lowerLine.includes(kw))) {
      // But skip very short lines or lines with just symbols
      if (charCount > 3 && !line.match(/^[•\-*]+[A-Z.]+[•\-*]*$/)) {
        card.company = line;
        companyFound = true;
        continue;
      }
    }

    // ADDRESS EXTRACTION
    if (addressKeywords.test(line) || /^\d+/.test(line)) {
      addressLines.push(line);
      continue;
    }
  }

  // Second pass: find name (prioritize lines that aren't title/company/address)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    const charCount = line.length;

    if (charCount < 2) continue;
    if (line.includes('@') || lowerLine.match(/^\+?\d/)) continue;
    
    // Skip if it's already identified as title, company, or address
    if (line === card.jobTitle || line === card.company) continue;
    if (addressLines.includes(line)) continue;

    // Skip lines that are just symbols/dots (logos)
    if (line.match(/^[•\-*•.]+$/) || line.match(/^[•\-*]+[A-Z.]+[•\-*]*$/)) continue;

    // NAME: Look for short lines (2-4 words) that appear early in the card
    if (!nameFound && i < 4 && charCount >= 3 && charCount <= 50) {
      let hasTitle = titleKeywords.some(kw => lowerLine.includes(kw));
      let hasCompany = companyKeywords.some(kw => lowerLine.includes(kw));
      
      if (!hasTitle && !hasCompany) {
        // Check if it looks like a name (has letters, not too many numbers)
        let letterCount = (line.match(/[a-zA-Z]/g) || []).length;
        let digitCount = (line.match(/\d/g) || []).length;
        
        if (letterCount > digitCount && !line.includes('•')) {
          card.fullName = line;
          nameFound = true;
          continue;
        }
      }
    }
  }

  // Combine address lines
  if (addressLines.length > 0) {
    card.address = addressLines.join(', ').substring(0, 200);
  }

  // FALLBACK: If name still not found
  if (!card.fullName && lines.length > 0) {
    for (let line of lines) {
      const lowerLine = line.toLowerCase();
      const charCount = line.length;
      
      if (charCount > 2 && charCount < 50 && !line.includes('@') && !line.includes('•')) {
        let hasKeyword = titleKeywords.some(kw => lowerLine.includes(kw)) ||
                        companyKeywords.some(kw => lowerLine.includes(kw));
        
        if (!hasKeyword && line !== card.jobTitle && line !== card.company) {
          // Prefer lines with actual letters
          let letterCount = (line.match(/[a-zA-Z]/g) || []).length;
          let digitCount = (line.match(/\d/g) || []).length;
          
          if (letterCount > digitCount) {
            card.fullName = line;
            break;
          }
        }
      }
    }
  }

  // FALLBACK COMPANY: If company still not found
  if (!card.company && lines.length > 1) {
    for (let line of lines) {
      if (line !== card.fullName && line !== card.jobTitle && 
          line.length > 10 && line.length < 80 && !line.includes('@') && !line.includes('•')) {
        card.company = line;
        break;
      }
    }
  }

  card.fullName = card.fullName.trim();
  card.jobTitle = card.jobTitle.trim();
  card.company = card.company.trim();
  card.address = card.address.trim();
  card.website = card.website.trim();

  return card;
}

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
    console.log('Received extract-card request');
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    
    if (!apiKey) {
      console.error('Missing API key');
      return res.status(500).json({ error: 'API key not configured' });
    }

    let base64Image = imageData;
    if (imageData.includes(',')) {
      base64Image = imageData.split(',')[1];
    }

    const visionApiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    console.log('Calling Vision API...');
    
    const visionResponse = await fetch(visionApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: base64Image
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION'
              }
            ]
          }
        ]
      })
    });

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Vision API error:', errorText);
      return res.status(500).json({ error: 'Vision API error', details: errorText });
    }

    const data = await visionResponse.json();

    const responses = data.responses;
    if (!responses || responses.length === 0) {
      return res.status(400).json({ error: 'No text detected in image' });
    }

    const textAnnotations = responses[0].textAnnotations;
    if (!textAnnotations || textAnnotations.length === 0) {
      return res.status(400).json({ error: 'No text found on business card' });
    }

    const fullText = textAnnotations[0].description;
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log('Parsing card with improved logic...');
    
    const cardInfo = parseBusinessCardIntelligently(lines, fullText);

    console.log('Success! Name:', cardInfo.fullName);

    return res.status(200).json({
      success: true,
      data: cardInfo,
      rawText: fullText
    });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({ 
      error: error.message
    });
  }
}
