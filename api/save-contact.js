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
    const { contactData, accessToken } = req.body;

    if (!contactData || !accessToken) {
      return res.status(400).json({ error: 'Missing contact data or access token' });
    }

    console.log('Saving contact:', contactData.fullName);
    console.log('Using OAuth token from user');

    // Parse name into given and family names
    const nameParts = contactData.fullName ? contactData.fullName.trim().split(/\s+/) : [];
    const givenName = nameParts.length > 0 ? nameParts[0] : '';
    const familyName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // Build contact object with correct Google People API schema
    const personData = {
      names: contactData.fullName ? [{ 
        givenName: givenName,
        familyName: familyName,
        displayName: contactData.fullName
      }] : [],
      
      emailAddresses: contactData.email ? [{ 
        value: contactData.email, 
        type: 'work' 
      }] : [],
      
      phoneNumbers: contactData.phone ? [{ 
        value: contactData.phone, 
        type: 'work' 
      }] : [],
      
      organizations: contactData.company || contactData.jobTitle ? [{ 
        name: contactData.company || '',
        title: contactData.jobTitle || ''
      }] : [],
      
      addresses: contactData.address ? [{ 
        formattedValue: contactData.address, 
        type: 'work' 
      }] : [],
      
      urls: contactData.website ? [{ 
        value: contactData.website, 
        type: 'homepage' 
      }] : [],
      
      biographies: contactData.notes ? [{ 
        value: contactData.notes 
      }] : []
    };

    // Remove empty arrays
    Object.keys(personData).forEach(key => {
      if (Array.isArray(personData[key]) && personData[key].length === 0) {
        delete personData[key];
      }
    });

    console.log('Contact payload:', JSON.stringify(personData));

    // Google People API endpoint
    const contactsApiUrl = 'https://people.googleapis.com/v1/people:createContact';

    console.log('Calling Google People API with user OAuth token...');

    // Call Google Contacts API using USER's OAuth token
    const contactsResponse = await fetch(contactsApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(personData)
    });

    console.log('People API response status:', contactsResponse.status);

    if (!contactsResponse.ok) {
      const errorData = await contactsResponse.json();
      console.error('People API error:', JSON.stringify(errorData));
      return res.status(contactsResponse.status).json({ 
        error: 'Failed to save contact to Google Contacts',
        details: errorData
      });
    }

    const savedContact = await contactsResponse.json();
    console.log('✅ Contact saved successfully:', savedContact.resourceName);

    return res.status(200).json({
      success: true,
      message: 'Contact saved to Google Contacts',
      resourceName: savedContact.resourceName
    });

  } catch (error) {
    console.error('Error saving contact:', error.message);
    return res.status(500).json({ 
      error: 'Failed to save contact',
      details: error.message 
    });
  }
}
