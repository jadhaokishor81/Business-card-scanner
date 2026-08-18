import axios from 'axios';

// Intelligent business card parser
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

  // Regex patterns
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?[\d]{3}\)?[-.\s]?[\d]{3}[-.\s]?[\d]{4}|(?:\+\d{1,3}[-.\s]?)?[\d]{7,15}|\+\d{1,3}\s?\d{1,14}/g;
  const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/g;
  const addressKeywords = /street|avenue|road|blvd|suite|floor|building|apt|box|p\.o\.|po box|city|state|zip|postal|country/i;

  // Extract structured data using regex
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
    card.website = urlMatches[0];
  }

  // Job title keywords
  const titleKeywords = [
    'director', 'manager', 'engineer', 'specialist', 'executive', 'president',
    'ceo', 'cto', 'cfo', 'consultant', 'developer', 'designer', 'analyst',
    'coordinator', 'officer', 'representative', 'lead', 'supervisor', 'head',
    'chief', 'associate', 'assistant', 'administrator', 'architect', 'producer',
    'strategist', 'partner', 'founder', 'vice', 'deputy', 'senior', 'principal',
    'sales', 'marketing', 'operations', 'finance'
  ];

  // Company keywords
  const companyKeywords = [
    'inc', 'ltd', 'corp', 'llc', 'pvt', 'gmbh', 'ag', 'co.', 'company',
    'group', 'solutions', 'services', 'systems', 'technologies', 'enterprises',
    'international', 'global', 'consultants', 'associates', 'partners',
    'corporation', 'industries'
  ];

  // Analyze each line
  let nameFound = false;
  let titleFound = false;
  let companyFound = false;
  const addressLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    const charCount = line.length;

    if (charCount < 2) continue;
    if (line.includes('@') || lowerLine.match(/^\+?\d/)) continue;

    // NAME EXTRACTION
    if (!nameFound && i < 3 && charCount < 60 && charCount > 3) {
      let hasTitle = titleKeywords.some(kw => lowerLine.includes(kw));
      let hasCompany = companyKeywords.some(kw => lowerLine.includes(kw));
      
      if (!hasTitle && !hasCompany) {
        card.fullName = line;
        nameFound = true;
        continue;
      }
    }

    // TITLE EXTRACTION
    if (!titleFound && titleKeywords.some(kw => lowerLine.includes(kw))) {
      card.jobTitle = line;
      titleFound = true;
      continue;
    }

    // COMPANY EXTRACTION
    if (!companyFound && companyKeywords.some(kw => lowerLine.includes(kw))) {
      card.company = line;
      companyFound = true;
      continue;
    }

    // ADDRESS EXTRACTION
    if (addressKeywords.test(line) || /^\d+/.test(line)) {
      addressLines.push(line);
      continue;
    }

    // FALLBACK NAME
    if (!nameFound && i === 0 && charCount < 60 && charCount > 3) {
      if (!line.includes('@') && !lowerLine.match(/^\+?\d/) && 
          !titleKeywords.some(kw => lowerLine.includes(kw))) {
        card.fullName = line;
        nameFound = true;
      }
    }
  }

  if (addressLines.length > 0) {
    card.address = addressLines.join(', ').substring(0, 200);
  }

  if (!card.fullName && lines.length > 0) {
    for (let line of lines) {
      if (line.length > 2 && line.length < 60 && !line.includes('@')) {
        const lowerLine = line.toLowerCase();
        const hasKeyword = titleKeywords.some(kw => lowerLine.includes(kw)) ||
                          companyKeywords.some(kw => lowerLine.includes(kw));
        if (!hasKeyword) {
          card.fullName = line;
          break;
        }
      }
    }
  }

  if (!card.company && lines.length > 1) {
    for (let line of lines) {
      if (line !== card.fullName && line !== card.jobTitle && 
          line.length > 10 && line.length < 80 && !line.includes('@')) {
        card.company = line;
        break;
      }
    }
  }

  card.fullName = card.fullName.trim();
  card.jobTitle = card.jobTitle.trim();
  card.company = card.company.trim();
  card.address = card.address.trim();

  return card;
}

// Vercel serverless function
export default async function handler(req, res) {
  // CORS headers
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

    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      console.error('Missing GOOGLE_CLOUD_API_KEY environment variable');
      return res.status(500).json({ error: 'API key not configured' });
    }

    let base64Image = imageData;
    if (imageData.includes(',')) {
      base64Image = imageData.split(',')[1];
    }

    const visionApiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    console.log('Calling Vision API...');
    
    const visionResponse = await axios.post(visionApiUrl, {
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
    });

    const responses = visionResponse.data.responses;
    if (!responses || responses.length === 0) {
      return res.status(400).json({ error: 'No text detected in image' });
    }

    const textAnnotations = responses[0].textAnnotations;
    if (!textAnnotations || textAnnotations.length === 0) {
      return res.status(400).json({ error: 'No text found on business card' });
    }

    const fullText = textAnnotations[0].description;
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log('Parsing card with', lines.length, 'lines');
    
    const cardInfo = parseBusinessCardIntelligently(lines, fullText);

    return res.status(200).json({
      success: true,
      data: cardInfo,
      rawText: fullText
    });

  } catch (error) {
    console.error('Error in /api/extract-card:', error.message);
    console.error('Error details:', error);
    return res.status(500).json({ 
      error: 'Failed to extract card information',
      details: error.message 
    });
  }
}
