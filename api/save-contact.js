import crypto from 'crypto';

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
    const { contactData } = req.body;

    if (!contactData) {
      return res.status(400).json({ error: 'Missing contact data' });
    }

    console.log('Saving contact:', contactData.fullName);

    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!serviceAccountKey) {
      return res.status(500).json({ 
        error: 'Service account credentials not configured. Add GOOGLE_SERVICE_ACCOUNT_KEY to Vercel environment variables.'
      });
    }

    let credentials;
    try {
      credentials = JSON.parse(serviceAccountKey);
    } catch (e) {
      return res.status(500).json({ 
        error: 'Invalid service account JSON format'
      });
    }

    // Generate JWT for service account
    const accessToken = await getServiceAccountToken(credentials);

    // Parse name
    const nameParts = contactData.fullName ? contactData.fullName.trim().split(/\s+/) : [];
    const givenName = nameParts[0] || '';
    const familyName = nameParts.slice(1).join(' ') || '';

    // Build contact object
    const contact = {};

    if (givenName || familyName) {
      contact.names = [{
        givenName,
        familyName,
        displayName: contactData.fullName
      }];
    }

    if (contactData.email) {
      contact.emailAddresses = [{
        value: contactData.email,
        type: 'work'
      }];
    }

    if (contactData.phone) {
      contact.phoneNumbers = [{
        value: contactData.phone,
        type: 'work'
      }];
    }

    if (contactData.company || contactData.jobTitle) {
      contact.organizations = [{
        name: contactData.company || '',
        title: contactData.jobTitle || ''
      }];
    }

    if (contactData.address) {
      contact.addresses = [{
        formattedValue: contactData.address,
        type: 'work'
      }];
    }

    if (contactData.website) {
      contact.urls = [{
        value: contactData.website,
        type: 'homepage'
      }];
    }

    if (contactData.notes) {
      contact.biographies = [{
        value: contactData.notes
      }];
    }

    console.log('Creating contact with:', JSON.stringify(contact));

    // Call People API
    const response = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contact)
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('People API error:', error);
      return res.status(response.status).json({
        error: 'Failed to save contact',
        details: error
      });
    }

    const result = await response.json();
    console.log('✅ Contact saved:', result.resourceName);

    return res.status(200).json({
      success: true,
      message: 'Contact saved successfully',
      resourceName: result.resourceName
    });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({
      error: 'Failed to save contact',
      details: error.message
    });
  }
}

async function getServiceAccountToken(credentials) {
  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT'
  })).toString('base64').replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/contacts',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64').replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(credentials.private_key, 'base64')
    .replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));

  const jwt = `${header}.${payload}.${signature}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}
