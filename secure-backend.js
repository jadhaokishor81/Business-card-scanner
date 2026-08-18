const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoding({ limit: '50mb' }));

// CORS configuration
const corsOptions = {
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://google-business-card-scanner.vercel.app',
    'https://google-business-card-scanner.vercel.app/',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Extract business card info using Google Cloud Vision
app.post('/api/extract-card', async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Vision API key not configured' });
    }

    // Prepare image for Vision API
    let base64Image = imageData;
    if (imageData.includes(',')) {
      base64Image = imageData.split(',')[1];
    }

    // Call Google Cloud Vision API
    const visionApiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

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

    // Extract full text
    const fullText = textAnnotations[0].description;
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Parse with intelligent logic
    const cardInfo = parseBusinessCardIntelligently(lines, fullText);

    res.json({
      success: true,
      data: cardInfo,
      rawText: fullText
    });

  } catch (error) {
    console.error('Error processing image:', error.message);
    res.status(500).json({ 
      error: 'Failed to extract card information',
      details: error.message 
    });
  }
});

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
    // Filter out numbers that are too long (likely not phone numbers)
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

  // Job title keywords (expanded list)
  const titleKeywords = [
    'director', 'manager', 'engineer', 'specialist', 'executive', 'president',
    'ceo', 'cto', 'cfo', 'consultant', 'developer', 'designer', 'analyst',
    'coordinator', 'officer', 'representative', 'lead', 'supervisor', 'head',
    'chief', 'associate', 'coordinator', 'assistant', 'administrator',
    'architect', 'producer', 'strategist', 'coordinator', 'partner', 'founder',
    'vice', 'deputy', 'senior', 'principal', 'sales', 'marketing', 'operations'
  ];

  // Company keywords (expanded list)
  const companyKeywords = [
    'inc', 'ltd', 'corp', 'llc', 'pvt', 'gmbh', 'ag', 'co.', 'company',
    'group', 'solutions', 'services', 'systems', 'technologies', 'enterprises',
    'international', 'global', 'usa', 'uk', 'india', 'singapore', 'consultants',
    'associates', 'partners', 'corporation', 'industries'
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

    // Skip very short lines (likely noise)
    if (charCount < 2) continue;

    // Skip lines that are just email or phone
    if (line.includes('@') || lowerLine.match(/^\+?\d/)) continue;

    // **NAME EXTRACTION** - Usually first 1-2 non-title, non-company lines
    if (!nameFound && i < 3 && charCount < 60 && charCount > 3) {
      let hasTitle = titleKeywords.some(kw => lowerLine.includes(kw));
      let hasCompany = companyKeywords.some(kw => lowerLine.includes(kw));
      
      if (!hasTitle && !hasCompany) {
        card.fullName = line;
        nameFound = true;
        continue;
      }
    }

    // **TITLE EXTRACTION** - Lines with title keywords
    if (!titleFound && titleKeywords.some(kw => lowerLine.includes(kw))) {
      card.jobTitle = line;
      titleFound = true;
      continue;
    }

    // **COMPANY EXTRACTION** - Lines with company keywords
    if (!companyFound && companyKeywords.some(kw => lowerLine.includes(kw))) {
      card.company = line;
      companyFound = true;
      continue;
    }

    // **ADDRESS EXTRACTION** - Lines with address keywords or numbers
    if (addressKeywords.test(line) || /^\d+/.test(line)) {
      addressLines.push(line);
      continue;
    }

    // If we haven't found name yet by line 3, use first non-special line
    if (!nameFound && i === 0 && charCount < 60 && charCount > 3) {
      if (!line.includes('@') && !lowerLine.match(/^\+?\d/) && !titleKeywords.some(kw => lowerLine.includes(kw))) {
        card.fullName = line;
        nameFound = true;
      }
    }
  }

  // Combine address lines
  if (addressLines.length > 0) {
    card.address = addressLines.join(', ').substring(0, 200);
  }

  // **FALLBACK NAME EXTRACTION** - If name still not found
  if (!card.fullName && lines.length > 0) {
    // Use first line that's reasonable length and doesn't contain special keywords
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

  // **FALLBACK COMPANY** - If company still not found, look for longest line that isn't name/title
  if (!card.company && lines.length > 1) {
    for (let line of lines) {
      if (line !== card.fullName && line !== card.jobTitle && 
          line.length > 10 && line.length < 80 && !line.includes('@')) {
        card.company = line;
        break;
      }
    }
  }

  // Clean up
  card.fullName = card.fullName.trim();
  card.jobTitle = card.jobTitle.trim();
  card.company = card.company.trim();
  card.address = card.address.trim();

  return card;
}

// Save contact
app.post('/api/save-contact', async (req, res) => {
  try {
    const { contactData, accessToken } = req.body;
    res.json({
      success: true,
      message: 'Contact data received.'
    });
  } catch (error) {
    console.error('Error saving contact:', error.message);
    res.status(500).json({ error: 'Failed to save contact' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
