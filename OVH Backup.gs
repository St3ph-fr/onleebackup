/*
 * Daily backup of Google Drive folders to an S3-compatible object storage in OVH.
 * 
 * SETUP:
 * 1. Ensure you have the 'S3.gs' and 'S3Request.gs' files in your project.
 * 2. Fill out all the details in CONFIG below.
 * 3. Enable the "Drive API" advanced service in your Apps Script project.
 *    (Editor -> Services (+) -> Google Drive API -> Add).
 * 4. Run 'createBackupTrigger()' once to authorize and set up the daily trigger.
 * 5. Run 'runBackup()' for manual launch
 * 
 * Option 1 : You can force upload of all files using FORCE_UPLOAD: true
 */

const CONFIG = {
  // 1. GOOGLE DRIVE FOLDER IDs
  // Add the ID of each Google Drive folder you want to back up.
  // Example: ['1a2b3c4d5e6f7g8h9i0j', '0k9j8h7g6f5e4d3c2b1a']
  FOLDER_IDS: ['id1','id2'],

  // 2. OVH S3 BUCKET CONFIGURATION
  OVH_S3: {
    accessKey: 'your_access',
    secretKey: 'your_secret',
    region: 'eu-west-par',
    endpoint: 'https://s3.eu-west-par.io.cloud.ovh.net/', // Check your region in the OVH console
    bucket: 'your_bucket' // Your bucket name
  },

  // 3. SCRIPT OPTIONS
  // Change to true to ignore modification dates and re-upload all files.
  FORCE_UPLOAD: false 
};

/**
 * Main function to start the backup process for all configured folders.
 * Can be run manually or by a trigger.
 */
function runBackup() {
  for (let i = 0; i < CONFIG.FOLDER_IDS.length; i++) {
    Logger.log('--- Starting backup for folder ID: %s ---', CONFIG.FOLDER_IDS[i]);
    backupFolderToS3(CONFIG.FOLDER_IDS[i]);
    Logger.log('--- Finished backup for folder ID: %s ---', CONFIG.FOLDER_IDS[i]);
  }
}

/**
 * Sets up a daily trigger to run the backup.
 */
function createBackupTrigger() {
  // First, delete any existing triggers for this function to avoid duplicates.
  deleteTriggersByName('runBackup');

  ScriptApp.newTrigger("runBackup")
    .timeBased()
    .atHour(5) // Runs at 5 AM
    .everyDays(1)
    .create();
  Logger.log('Daily backup trigger created successfully.');
}

/**
 * Utility to delete all triggers for a specific function.
 * @param {string} functionName The name of the function whose triggers should be deleted.
 */
function deleteTriggersByName(functionName) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Deleted existing trigger for %s.', functionName);
    }
  }
}

/**
 * Finds all files in a given Drive folder and uploads them to S3 if they have been modified.
 * @param {string} folderId The ID of the Google Drive folder.
 */
function backupFolderToS3(folderId) {
  // Instantiate the S3 service once per folder run.
  const s3 = getInstance(CONFIG.OVH_S3.accessKey, CONFIG.OVH_S3.secretKey, {
    region: CONFIG.OVH_S3.region,
    endpoint: CONFIG.OVH_S3.endpoint
  });

  const query = `"${folderId}" in parents and trashed = false and mimeType != "application/vnd.google-apps.folder"`;
  let pageToken = null;

  do {
    try {
      const files = Drive.Files.list({
        q: query,
        maxResults: 100,
        pageToken: pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      if (!files.items || files.items.length === 0) {
        if (!pageToken) console.log('No files found in this folder.');
        return;
      }

      for (let i = 0; i < files.items.length; i++) {
        let file = files.items[i];
        
        // Handle shortcuts by getting the target file.
        if (file.mimeType === 'application/vnd.google-apps.shortcut') {
          try {
            file = getFileFromShortcut(file.id);
          } catch (e) {
            console.log(`Skipping shortcut: Could not access target file for shortcut "${file.title}" (ID: ${file.id}).`);
            continue;
          }
        }
        
        const lastSyncedTimestamp = getFileProperty('synced_date', file.id);
        const modifiedTimestamp = new Date(file.modifiedDate).getTime();

        if (lastSyncedTimestamp && !CONFIG.FORCE_UPLOAD && modifiedTimestamp <= lastSyncedTimestamp) {
          console.log(`Skipped (not modified): "${file.title}" (ID: ${file.id})`);
        } else {
          console.log(`Uploading (modified): "${file.title}" (ID: ${file.id})`);
          const uploadResult = uploadFileToS3(s3, file, folderId);
          if (uploadResult.success) {
            setFileProperty('synced_date', modifiedTimestamp, file.id);
            console.log(`  -> Successfully uploaded to S3 as: ${uploadResult.objectName}`);
          }
        }
      }
      pageToken = files.nextPageToken;
    } catch (err) {
      console.log('Failed during file listing with error: %s', err.message);
      pageToken = null; // Stop processing on error to avoid infinite loops.
    }
  } while (pageToken);
}

// Mime types for converting Google Docs to standard formats.
const EXPORT_MIME_TYPES = {
  "application/vnd.google-apps.document": { extension: "docx", type: MimeType.MICROSOFT_WORD },
  "application/vnd.google-apps.presentation": { extension: "pptx", type: MimeType.MICROSOFT_POWERPOINT },
  "application/vnd.google-apps.spreadsheet": { extension: "xlsx", type: MimeType.MICROSOFT_EXCEL },
  "application/vnd.google-apps.drawing": { extension: "png", type: MimeType.PNG }
};

/**
 * Uploads a single file object to the S3 bucket.
 * @param {S3} s3Instance An initialized instance of our S3 library.
 * @param {Drive.Files.File} file The Drive file object.
 * @param {string} folderId The ID of the parent folder, used to create the path in S3.
 * @return {{success: boolean, objectName?: string}} An object indicating success and the S3 object name.
 */
function uploadFileToS3(s3Instance, file, folderId) {
  try {
    let blob;
    let fileName;
    const exportFormat = EXPORT_MIME_TYPES[file.mimeType];

    if (exportFormat) {
      // This is a Google Doc, so we need to export it.
      const response = UrlFetchApp.fetch(file.exportLinks[exportFormat.type], {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      });
      if(response.getResponseCode() >= 400){
        throw new Error(`Failed to export Google Doc. Server responded with ${response.getResponseCode()}`);
      }
      blob = response.getBlob();
      fileName = file.title + '.' + exportFormat.extension;
    } else {
      // This is a standard file (PDF, image, etc.).
      blob = DriveApp.getFileById(file.id).getBlob();
      fileName = file.title;
    }

    // Define the full path for the object in the S3 bucket.
    const objectName = folderId + '/' + fileName;

    // Use our S3 library to put the object.
    s3Instance.putObject(CONFIG.OVH_S3.bucket, objectName, blob);
    
    return { success: true, objectName: objectName };

  } catch (e) {
    console.log(`  -> ERROR uploading "${file.title}": ${e.toString()}`);
    return { success: false };
  }
}

// --- GOOGLE DRIVE HELPER FUNCTIONS (mostly unchanged) ---

/**
 * Retrieves the target file from a shortcut.
 * @param {string} shortcutId The ID of the shortcut file.
 * @return {Drive.Files.File} The target file object.
 */
function getFileFromShortcut(shortcutId) {
  const response = UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files/${shortcutId}?fields=shortcutDetails(targetId)`, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }
  );
  const targetId = JSON.parse(response).shortcutDetails.targetId;
  return Drive.Files.get(targetId);
}

/**
 * Sets a custom property on a Drive file.
 * @param {string} key The property key.
 * @param {any} value The property value.
 * @param {string} fileId The ID of the file.
 */
function setFileProperty(key, value, fileId) {
  try {
    Drive.Properties.insert({ key: key, value: String(value), visibility: 'PRIVATE' }, fileId);
  } catch (e) {
    console.log(`Error setting property "${key}" for file ID ${fileId}: ${e.message}`);
  }
}

/**
 * Gets a custom property from a Drive file.
 * @param {string} key The property key.
 * @param {string} fileId The ID of the file.
 * @return {string|null} The property value or null if not found.
 */
function getFileProperty(key, fileId) {
  try {
    const prop = Drive.Properties.get(fileId, key, { visibility: 'PRIVATE' });
    return prop.value;
  } catch (e) {
    // This usually means the property doesn't exist, which is a normal condition.
    return null;
  }
}
