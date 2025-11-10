// --- OVH S3 CONFIGURATION ---
const OVH_CONFIG = {
  accessKey: 'your_key',
  secretKey: 'your_secret',
  region: 'eu-west-par',
  endpoint: 'https://s3.eu-west-par.io.cloud.ovh.net/', // For reference https://help.ovhcloud.com/csm/en-public-cloud-storage-s3-location?id=kb_article_view&sysparm_article=KB0047384
  bucket: 'your_bucket'
};

function uploadFileToOVH() {
  try {
    // 1. Instantiate the S3 service with your OVH configuration
    const s3 = getInstance(OVH_CONFIG.accessKey, OVH_CONFIG.secretKey, {
      region: OVH_CONFIG.region,
      endpoint: OVH_CONFIG.endpoint
    });
    
    // 2. Define the object to upload
    const bucketName = OVH_CONFIG.bucket;
    const objectName = 'test-from-gas/' + new Date().toISOString() + '.txt';
    const fileContent = 'Hello from Google Apps Script at ' + new Date();
    
    // You can also upload Blobs, for example, from a Google Doc or Sheet
    // const blob = DriveApp.getFileById('YOUR_FILE_ID').getBlob();
    
    Logger.log('Uploading "%s" to bucket "%s"...', objectName, bucketName);

    // 3. Put the object in the bucket
    s3.putObject(bucketName, objectName, fileContent, {logRequests: true});
    
    Logger.log('Upload successful!');
    
    // 4. (Optional) Retrieve the object to verify
    Logger.log('Retrieving object to verify...');
    const retrievedObject = s3.getObject(bucketName, objectName, {logRequests: true});
    
    if (retrievedObject) {
      const retrievedContent = retrievedObject.getDataAsString();
      Logger.log('Retrieved content: %s', retrievedContent);
      
      if (retrievedContent === fileContent) {
        Logger.log('SUCCESS: Content matches!');
      } else {
        Logger.log('ERROR: Content mismatch!');
      }
    } else {
      Logger.log('ERROR: Could not retrieve object.');
    }

  } catch (e) {
    Logger.log('An error occurred: %s', e.toString());
    Logger.log('Stack: %s', e.stack);
    if (e.httpRequestLog) {
      Logger.log('--- HTTP Request/Response Log ---');
      Logger.log(e.httpRequestLog);
    }
  }
}
