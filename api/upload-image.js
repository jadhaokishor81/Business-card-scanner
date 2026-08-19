export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageData, fileName, accessToken, contactName } = req.body;

    if (!imageData || !accessToken) {
      return res.status(400).json({ error: 'Missing image data or access token' });
    }

    console.log('Uploading image to Google Drive:', fileName);

    // Step 1: Create or get the Business Card Scanner folder
    const folderName = 'Business Card Scanner';
    let folderId = await getOrCreateFolder(folderName, accessToken);

    if (!folderId) {
      return res.status(500).json({ error: 'Failed to create folder in Google Drive' });
    }

    console.log('Using folder:', folderId);

    // Step 2: Upload image to the folder
    const fileMetadata = {
      name: fileName || `${contactName || 'Card'}-${Date.now()}.jpg`,
      parents: [folderId],
      mimeType: 'image/jpeg'
    };

    // Convert data URL to blob
    let base64Data = imageData;
    if (imageData.includes(',')) {
      base64Data = imageData.split(',')[1];
    }

    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create FormData for multipart upload
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
    form.append('file', new Blob([bytes], { type: 'image/jpeg' }));

    const uploadResponse = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        body: form
      }
    );

    console.log('Drive API upload response:', uploadResponse.status);

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json();
      console.error('Drive API error:', errorData);
      return res.status(uploadResponse.status).json({ 
        error: 'Failed to upload image to Google Drive',
        details: errorData
      });
    }

    const uploadedFile = await uploadResponse.json();
    console.log('Image uploaded successfully:', uploadedFile.id);

    return res.status(200).json({
      success: true,
      message: 'Image saved to Google Drive',
      fileId: uploadedFile.id,
      folderId: folderId
    });

  } catch (error) {
    console.error('Error uploading image:', error.message);
    return res.status(500).json({ 
      error: 'Failed to upload image',
      details: error.message
    });
  }
}

// Helper function to get or create folder
async function getOrCreateFolder(folderName, accessToken) {
  try {
    // Search for existing folder
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false&spaces=drive&fields=files(id)`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      }
    );

    const searchData = await searchResponse.json();

    if (searchData.files && searchData.files.length > 0) {
      console.log('Folder exists:', searchData.files[0].id);
      return searchData.files[0].id;
    }

    // Folder doesn't exist, create it
    console.log('Creating new folder:', folderName);

    const createResponse = await fetch(
      'https://www.googleapis.com/drive/v3/files',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder'
        })
      }
    );

    const createData = await createResponse.json();
    console.log('Folder created:', createData.id);
    return createData.id;

  } catch (error) {
    console.error('Error managing folder:', error.message);
    return null;
  }
}
