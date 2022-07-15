function restoreDriveFolder() {
  const convertOfficeFiles = true; // Longer process if true, can run out of time if too much Google files
  const folderId = 'YOUR_ID_OF_FOLDER_SOURCE'; // Folder ID source, must be a folder in cloud storage too
  
  const restoreFolder = DriveApp.createFolder('onleebackup-'+folderId)
  
  let pageToken = '' ;

  do{
    let url =  'https://storage.googleapis.com/storage/v1/b/'+BUCKET_NAME+'/o?pagetoken='+pageToken+'&prefix='+folderId+'/'
    console.log(url)
    let req = UrlFetchApp.fetch(url,{
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + getToken(),
      }
    });
    let json = JSON.parse(req.getContentText())
    if(json.items && json.items.length != 0){
      let items = json.items;
      items.forEach(function (item,idx){
        let blob = getBlob(item.mediaLink);
        console.log(JSON.stringify(item))
        let convert = false ;
        if(convertOfficeFiles){
          if(item.contentType == MimeType.MICROSOFT_EXCEL || item.contentType == MimeType.MICROSOFT_POWERPOINT || item.contentType == MimeType.MICROSOFT_WORD){
            convert = true
          }
        }
        let params = {title:item.name.split('/')[1],
            parents:[{id:restoreFolder.getId()}]
            }
            console.log(params)
        let restorefile = Drive.Files.insert(params,blob,{convert:convert})
        console.log(JSON.stringify(restorefile))
      });
    }
  }while(pageToken)
}

function getBlob(url){
  return UrlFetchApp.fetch(url,{
    method: 'GET',
      headers: {
        Authorization: 'Bearer ' + getToken(),
      }
  }).getBlob()
}
