const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
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

    // Get credentials from environment
    const credentials = process.env.GOOGLE_VISION_CREDENTIALS;
    if (!credentials) {
      return res.status(500).json({ error: 'Vision API credentials not configured' });
    }

    const credentialsObj = JSON.parse(credentials);
    const projectId = credentialsObj.project_id;

    // Prepare image for Vision API (remove data:image/jpeg;base64, prefix if present)
    let base64Image = imageData;
    if (imageData.includes(',')) {
      base64Image = imageData.split(',')[1];
    }

    // Call Google Cloud Vision API
    const visionApiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_CLOUD_API_KEY}`;

    if (!process.env.GOOGLE_CLOUD_API_KEY) {
      return res.status(500).json({ error: 'Google Cloud API key not configured' });
    }

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
    const lines = fullText.split('\n').filter(line => line.trim());

    // Parse the card intelligently
    const cardInfo = parseBusinessCard(lines, fullText);

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

// Intelligent parser for business card text
function parseBusinessCard(lines, fullText) {
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

  // Email regex
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  // Phone regex (various formats)
  const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?[\d]{3}\)?[-.\s]?[\d]{3}[-.\s]?[\d]{4}|(?:\+\d{1,3})?[\d]{7,15}/g;
  // URL regex
  const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/g;

  // Find emails
  const emailMatches = fullText.match(emailRegex);
  if (emailMatches) {
    card.email = emailMatches[0]; // Take first email
  }

  // Find phone numbers
  const phoneMatches = fullText.match(phoneRegex);
  if (phoneMatches) {
    card.phone = phoneMatches[0]; // Take first phone
  }

  // Find URLs
  const urlMatches = fullText.match(urlRegex);
  if (urlMatches) {
    card.website = urlMatches[0]; // Take first URL
  }

  // Parse lines to extract name, title, company
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();

    // Skip empty lines and common words
    if (line.length < 2) continue;

    // First line is usually name (if it's not an email or typical title)
    if (i === 0 && !line.includes('@') && line.length > 3 && line.length < 50) {
      card.fullName = line;
      continue;
    }

    // Look for job titles
    if (lowerLine.includes('director') || 
        lowerLine.includes('manager') || 
        lowerLine.includes('engineer') ||
        lowerLine.includes('specialist') ||
        lowerLine.includes('executive') ||
        lowerLine.includes('president') ||
        lowerLine.includes('ceo') ||
        lowerLine.includes('cto') ||
        lowerLine.includes('consultant') ||
        lowerLine.includes('developer') ||
        lowerLine.includes('designer') ||
        lowerLine.includes('analyst') ||
        lowerLine.includes('coordinator') ||
        lowerLine.includes('officer') ||
        lowerLine.includes('representative') ||
        lowerLine.includes('lead')) {
      card.jobTitle = line;
    }

    // Look for company names
    if (lowerLine.includes('inc') ||
        lowerLine.includes('ltd') ||
        lowerLine.includes('corp') ||
        lowerLine.includes('llc') ||
        lowerLine.includes('pvt') ||
        lowerLine.includes('gmbh') ||
        lowerLine.includes('ag') ||
        lowerLine.includes('co.') ||
        lowerLine.includes('company') ||
        lowerLine.includes('group') ||
        lowerLine.includes('solutions') ||
        lowerLine.includes('services') ||
        lowerLine.includes('systems')) {
      card.company = line;
    }

    // Look for addresses (lines with numbers or common address words)
    if ((lowerLine.includes('street') || 
         lowerLine.includes('avenue') ||
         lowerLine.includes('road') ||
         lowerLine.includes('blvd') ||
         lowerLine.includes('city') ||
         lowerLine.includes('state') ||
         lowerLine.includes('zip') ||
         lowerLine.includes('suite') ||
         lowerLine.includes('floor') ||
         /^\d+/.test(line)) &&
        !card.email.includes(line)) {
      if (card.address) {
        card.address += ', ' + line;
      } else {
        card.address = line;
      }
    }
  }

  // If name not found, use first line
  if (!card.fullName && lines.length > 0) {
    card.fullName = lines[0].trim();
  }

  // Clean up the data
  card.fullName = card.fullName.trim();
  card.jobTitle = card.jobTitle.trim();
  card.company = card.company.trim();
  card.address = card.address.trim().substring(0, 200); // Limit address length

  return card;
}

// Save contact to Google Contacts (optional future enhancement)
app.post('/api/save-contact', async (req, res) => {
  try {
    const { contactData, accessToken } = req.body;

    // This would integrate with Google Contacts API
    // For now, just acknowledge the request
    res.json({
      success: true,
      message: 'Contact data received. Integration with Google Contacts coming soon.'
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
