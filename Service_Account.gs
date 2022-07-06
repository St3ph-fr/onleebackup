/*
 * To test Service Account run function testSA()
 * 
 */

const KEY = {
  "type": "service_account",
  "project_id": "",
  "private_key_id": "",
  "private_key": "-----BEGIN PRIVATE KEY-----\n.....\n-----END PRIVATE KEY-----\n",
  "client_email": "",
  "client_id": ""
}

/**
 * Authorizes and makes a request to the Google Drive API.
 */
function testSA() {
  var service = getService();
  if (service.hasAccess()) {
    var url = 'https://storage.googleapis.com/storage/v1/b/'+BUCKET_NAME;
    var response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + service.getAccessToken()
      }
    });
    var result = JSON.parse(response.getContentText());
    Logger.log('You have access to the Bucket : ' + result.name);
  } else {
    Logger.log(service.getLastError());
  }
}

/**
 * Reset the authorization state, so that it can be re-tested.
 */
function reset() {
  getService().reset();
}

/**
 * Configures the service.
 */
function getService() {
  return OAuth2.createService('STORAGE' )
      // Set the endpoint URL.
      .setTokenUrl('https://oauth2.googleapis.com/token')

      // Set the private key and issuer.
      .setPrivateKey(KEY.private_key)
      .setIssuer(KEY.client_email)

      // Set the name of the user to impersonate. This will only work for
      // Google Apps for Work/EDU accounts whose admin has setup domain-wide
      // delegation:
      // https://developers.google.com/identity/protocols/OAuth2ServiceAccount#delegatingauthority
      // .setSubject(USER_EMAIL)

      // Set the property store where authorized tokens should be persisted.
      .setPropertyStore(PropertiesService.getUserProperties())

      // Set the scope. This must match one of the scopes configured during the
      // setup of domain-wide delegation.
      .setScope(['https://www.googleapis.com/auth/devstorage.read_write']);
}
