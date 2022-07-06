const FOLDER_ID = ['FOLDER_ID_1','FOLDER_ID_2'];
const BUCKET_NAME = 'bucket-name'; 
const FORCE_UPLOAD = false; // Change to true to reupload all the folder.
const USE_SA = false; // You can use a service account to manage access to bucket

/*
 * Daily backup of Google Drive folders to Google Coud Storage
 * 
 * Made by Stéphane Giron (https://twitter.com/st3phcloud)
 * 0. Enter folders in FOLDER_ID and Cloud Storage bucket name in BUCKET_NAME
 * 1. Launch createTrigger() a first time to validate scope
 * 2. Run a second time the createTrigger() function
 * 3. For manual launch, run function onleebackup()
 * 
 */

function onleebackup(){
  for(let i = 0 ; i < FOLDER_ID.length ; i++){
    uploadFilesFromFolderToCloudStorage(FOLDER_ID[i])
  }
}

function createTrigger(){
  ScriptApp.newTrigger("onleebackup")
  .timeBased()
  .atHour(5)
  .everyDays(1) 
  .create();
}

function deleteTriggers(){
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}

function uploadFilesFromFolderToCloudStorage(folderId) {

  const query = '"'+folderId+'" in parents and trashed = false and ' +
    'mimeType != "application/vnd.google-apps.folder"';
  let files;
  let pageToken = null;
  const now = new Date().getTime();
  do {
    try {
      files = Drive.Files.list({
        q: query,
        maxResults: 100,
        pageToken: pageToken
      });
      if (!files.items || files.items.length === 0) {
        console.log('No files found.');
        return;
      }
      for (let i = 0; i < files.items.length; i++) {
        let file = files.items[i];
        if(file.mimeType == 'application/vnd.google-apps.shortcut'){
          try{
            file = getFileFromShortcut(file.id)
          }catch(e){
            console.log('Error you don\'t have access to file for shortcut id : '+file.id);
            continue;
          }
        }
        let lastUpdate = getKeyUpdate(file.id);
        console.log('Last update : '+lastUpdate)
        let modifiedDate = new Date(file.modifiedDate).getTime();
        if(lastUpdate && !FORCE_UPLOAD){
          if(modifiedDate > lastUpdate){
            let upoloaded = uploadFileToCloudStorage(file,folderId)
            console.log('%s (ID: %s) has been updated', file.title, file.id);
            insertKeyProp('synced_date',modifiedDate,file.id)
          }else{
            console.log('File with ID '+file.id+' not uploaded, no change on the file.')
          }

        }else{
          let uploaded = uploadFileToCloudStorage(file,folderId);
          console.log('%s (ID: %s) has been uploaded', file.title, file.id);
          console.log('Cloud Storage link %s',uploaded.selfLink)
          insertKeyProp('synced_date',modifiedDate,file.id)
          insertKeyProp('id_storage',uploaded.id,file.id)

        }
       
      }
      pageToken = files.nextPageToken;
    } catch (err) {
      console.log('Failed with error %s', err.message);
    }
  } while (pageToken);
}

const mime = {
  "application/vnd.google-apps.document":{extension:"docx",type:MimeType.MICROSOFT_WORD},
  "application/vnd.google-apps.presentation":{extension:"pptx",type:MimeType.MICROSOFT_POWERPOINT},
  "application/vnd.google-apps.spreadsheet":{extension:"xlsx",type:MimeType.MICROSOFT_EXCEL},
  "application/vnd.google-apps.drawing":{extension:"png",type:MimeType.PNG}
}

function uploadFileToCloudStorage(file,folderId){
  let blob ; let fileName ;

  if(mime[file.mimeType]){
    blob = UrlFetchApp.fetch(file.exportLinks[mime[file.mimeType].type],{
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      }
    }).getBlob();
    fileName = file.title+'.'+mime[file.mimeType].extension ;
    // DriveApp.getFileById(file.id).getAs(mime[file.mimeType])
  }else{
    blob = DriveApp.getFileById(file.id).getBlob();
    fileName = file.title ;
  }
  const bytes = blob.getBytes();
  const url = 'https://www.googleapis.com/upload/storage/v1/b/BUCKET/o?uploadType=media&name=FILE'
    .replace('BUCKET', BUCKET_NAME)
    .replace('FILE', folderId + '/' + encodeURIComponent(fileName));

  const options = {
    method: 'POST',
    contentLength: bytes.length,
    contentType: blob.getContentType(),
    payload: bytes,
    headers: {
      Authorization: 'Bearer ' + getToken(),
    }
  };
  const req = UrlFetchApp.fetch(url, options);
  const rep = JSON.parse(req.getContentText());

  return rep;
}

function getToken(){
  if(USE_SA){
    var service = getService();
    if (service.hasAccess()) {
      return service.getAccessToken();
    }
    throw 'Service account don\'t have access to the bucket or is badly setup.';
  }

  return ScriptApp.getOAuthToken();
}

function getFileFromShortcut(id){
  let rep = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+id+'?fields=shortcutDetails(targetId)',
  {method: 'GET',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  return Drive.Files.get(JSON.parse(rep).shortcutDetails.targetId)
}

function insertKeyProp(keyid,keyval,fileId){
  try{
    Drive.Properties.insert({key:keyid,value:keyval},fileId)
  }catch(e){
    console.log('Error to set property for file id : '+fileId)
    console.log('Error : '+e.message)
  }
  return true
}

function getKeyUpdate(fileId){
  return getProp('synced_date',fileId)
  
}

function getProp(keyid,fileId){
  try{
    let prop = Drive.Properties.get(fileId,keyid)
    return prop.value
  }catch(e){
    return false;
  }
}
