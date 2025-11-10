/*
 * Most code of AWS Signature Version 4 is ported from the aws-sdk-js
 * https://github.com/aws/aws-sdk-js/blob/7cc9ae5b0d7b2935fa69dee945d5f3e6e638c660/lib/signers/v4.js
 * 
 * MODIFIED FOR OVH S3-COMPATIBLE API
 */

/* constructs an S3Request to an S3 service
 *
 * @constructor
 * @param {S3} service S3 service to which this request will be sent
 */
function S3Request(service) {
  this.service = service;

  this.httpMethod = "GET";
  this.contentType = "";
  this.content = ""; //content of the HTTP request
  this.bucket = ""; //gets turned into part of the path
  this.objectName = "";
  this.headers = {};

  this.date = new Date();
  this.serviceName = 's3';
  
  // --- MODIFICATION FOR OVH ---
  this.region = service.region;
  this.endpoint = service.endpoint; // e.g., 'https://s3.eu-west-par.io.cloud.ovh.net/'
  // --- END MODIFICATION ---
  
  this.expiresHeader = 'presigned-expires';
  this.extQueryString = '';
}

/* sets contenetType of the request
 * @param {string} contentType mime-type, based on RFC, indicated how content is encoded
 * @return {S3Request} this request, for chaining
 */
S3Request.prototype.setContentType = function (contentType) {
  if (typeof contentType != 'string') throw 'contentType must be passed as a string';
  this.contentType = contentType;
  return this;
};

S3Request.prototype.getContentType = function () {
  if (this.contentType) {
    return this.contentType;
  } else {
    if (this.httpMethod == "PUT" || this.httpMethod == "POST") {
      return "application/x-www-form-urlencoded";
    }
  }
  return "";
}

/* sets content of request
 * @param {string|byte[]} content request content
 * @return {S3Request} this request, for chaining
 */
S3Request.prototype.setContent = function(content) {
  this.content = content;
  return this;
};

S3Request.prototype.setHttpMethod = function(method) {
  this.httpMethod = method;
  return this;
};

S3Request.prototype.setBucket = function(bucket) {
  this.bucket = bucket;
  return this;
};

S3Request.prototype.setObjectName = function(objectName) {
  this.objectName = objectName;
  return this;
};

S3Request.prototype.addHeader = function(name, value) {
  this.headers[name] = value; // Do not URI encode here, let UrlFetchApp handle it.
  return this;
};

// --- MAJOR MODIFICATION FOR OVH ---
S3Request.prototype._getUrl = function() {
  // Use path-style requests: https://endpoint/bucket/object
  var url = this.endpoint;
  if (this.bucket) {
    url += this.bucket;
    if (this.objectName) {
      // For the final URL, we also need to encode the object name properly
       var encodedObjectName = this.objectName.split('/').map(function(part) {
         return encodeURIComponent(part);
       }).join('/');
      url += '/' + (encodedObjectName.startsWith('/') ? encodedObjectName.substring(1) : encodedObjectName);
    }
  }
  return url;
};
// --- END MODIFICATION ---

S3Request.prototype.getUrl = function() {
  // Note: _getUrl now handles the encoding needed for the final URL.
  // The canonical URI has its own separate encoding logic.
  return this._getUrl() + this.extQueryString;
};

S3Request.prototype.execute = function(options) {
  options = options || {};
  for (var key in options) {
    var lowerKey = key.toLowerCase()
    if (lowerKey.indexOf('x-amz-') === 0) {
      this.addHeader(key, options[key])
    }
  }

  delete this.headers['Authorization'];
  delete this.headers['Date'];
  delete this.headers['X-Amz-Date'];
  
  // --- MODIFICATION FOR OVH ---
  // The host is just the endpoint domain, without protocol or trailing slash
  this.headers['Host'] = this.endpoint.replace(/https?:\/\//, '').replace(/\/$/, '');
  this.headers['X-Amz-Content-Sha256'] = this.hexEncodedBodyHash();
  // --- END MODIFICATION ---

  var credentials = {
    accessKeyId: this.service.accessKeyId,
    secretAccessKey: this.service.secretAccessKey,
    sessionToken: options.sessionToken
  }

  this.addAuthorization(credentials, this.date)
  
  // To avoid conflict with UrlFetchApp#fetch. UrlFetchApp#fetch adds its own Host header.
  delete this.headers['Host']

  var params = {
    method: this.httpMethod,
    payload: this.content,
    headers: this.headers,
    muteHttpExceptions: true
  }

  if (this.getContentType()) {
    params.contentType = this.getContentType();
  }
  
  var url = this.getUrl();
  var response = UrlFetchApp.fetch(url, params);

  var request = UrlFetchApp.getRequest(url, params);
  
  this.service.logExchange_(request, response);
  if (options.logRequests) {
    Logger.log(this.service.getLastExchangeLog());
  }

  if (options.echoRequestToUrl) {
    UrlFetchApp.fetch(options.echoRequestToUrl, params);
  }

  if (response.getResponseCode() > 299) {
    var error = {};
    error.name = "S3Error"; // Changed from AwsError to be more generic
    try {
      var errorXmlElements = XmlService.parse(response.getContentText()).getRootElement().getChildren();
      for (var i in errorXmlElements) {
        var name = errorXmlElements[i].getName();
        name = name.charAt(0).toLowerCase() + name.slice(1);
        error[name] = errorXmlElements[i].getText();
      }
      error.toString = function() { return "S3 Error - "+this.code+": "+this.message; };
      error.httpRequestLog = this.service.getLastExchangeLog();
    } catch (e) {
      error.message = "S3 service returned HTTP code " + response.getResponseCode() + ", but error content could not be parsed."
      error.toString = function () { return this.message; };
      error.httpRequestLog = this.service.getLastExchangeLog();
    }
    throw error;
  }

  return response;
};

// --- AWS Signature v4 Logic ---

S3Request.prototype.addAuthorization = function(credentials, date) {
  var datetime = date.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  this.addHeaders(credentials, datetime);
  this.headers['Authorization'] = this.authorization(credentials, datetime)
}

S3Request.prototype.addHeaders = function (credentials, datetime) {
  this.headers['X-Amz-Date'] = datetime;
  if (credentials.sessionToken) {
    this.headers['x-amz-security-token'] = credentials.sessionToken;
  }
}

S3Request.prototype.authorization = function(credentials, datetime) {
  var parts = [];
  var credString = this.credentialString(datetime);
  parts.push('AWS4-HMAC-SHA256 Credential=' + credentials.accessKeyId + '/' + credString);
  parts.push('SignedHeaders=' + this.signedHeaders());
  parts.push('Signature=' + this.signature(credentials, datetime));
  return parts.join(', ');
}

S3Request.prototype.signature = function(credentials, datetime) {
  var signingKey = this.getSignatureKey(
    credentials.secretAccessKey,
    datetime.substr(0, 8),
    this.region,
    this.serviceName
  )
  var signature = Utilities.computeHmacSha256Signature(Utilities.newBlob(this.stringToSign(datetime)).getBytes(), signingKey);
  return this.hex(signature)
}

S3Request.prototype.hex = function(values) {
  return values.reduce(function(str, chr){
    chr = (chr < 0 ? chr + 256 : chr).toString(16);
    return str + (chr.length == 1 ? '0' : '') + chr;
  }, '');
}

S3Request.prototype.getSignatureKey = function(key, dateStamp, regionName, serviceName) {
  var kDate = Utilities.computeHmacSha256Signature(dateStamp, "AWS4" + key);
  var kRegion = Utilities.computeHmacSha256Signature(Utilities.newBlob(regionName).getBytes(), kDate);
  var kService = Utilities.computeHmacSha256Signature(Utilities.newBlob(serviceName).getBytes(), kRegion);
  var kSigning = Utilities.computeHmacSha256Signature(Utilities.newBlob("aws4_request").getBytes(), kService);
  return kSigning;
}

S3Request.prototype.stringToSign = function(datetime) {
  var parts = [];
  parts.push('AWS4-HMAC-SHA256');
  parts.push(datetime);
  parts.push(this.credentialString(datetime));
  parts.push(this.hexEncodedHash(this.canonicalString()));
  return parts.join('\n');
}

S3Request.prototype.canonicalString = function() {
  var parts = [];
  // For canonical string, we use the unencoded URL path parts
  var urlForSigning = this.endpoint;
  if (this.bucket) {
    urlForSigning += this.bucket + (this.objectName ? '/' + this.objectName : '');
  }
  var [base, search] = urlForSigning.split("?", 2);

  parts.push(this.httpMethod);
  parts.push(this.canonicalUri()); // This now uses the correct encoding
  parts.push(this.canonicalQueryString(search));
  parts.push(this.canonicalHeaders() + '\n');
  parts.push(this.signedHeaders());
  parts.push(this.hexEncodedBodyHash());
  return parts.join('\n');
}

// --- THIS IS THE CORRECTED FUNCTION ---
S3Request.prototype.canonicalUri = function() {
  // For path-style, the canonical URI is /bucket/object
  var path = '/';
  if (this.bucket) {
    path += this.bucket;
    if (this.objectName) {
      // Split the object name into parts, encode each part, then rejoin.
      // This correctly preserves slashes while encoding special characters within parts.
       var encodedObjectName = this.objectName.split('/').map(function(part) {
         return encodeURIComponent(part);
       }).join('/');
       path += '/' + encodedObjectName;
    }
  }
  return path;
}
// --- END CORRECTION ---

S3Request.prototype.canonicalQueryString = function(values) {
  if (!values) return ""
  var parts = [];
  var items = values.split("&");
  for (var i in items) {
    var [key, value] = items[i].split("=")
    parts.push(encodeURIComponent(key) + "=" + (value !== undefined ? encodeURIComponent(value) : ''))
  }
  return parts.sort().join("&")
}

S3Request.prototype.canonicalHeaders = function() {
  var parts = [];
  var headers = this.headers;
  for (var item in headers) {
    var key = item.toLowerCase();
    if (this.isSignableHeader(key)) {
      var header = key + ":" + this.canonicalHeaderValues(headers[item].toString())
      parts.push(header)
    }
  }
  return parts.sort().join("\n")
}

S3Request.prototype.canonicalHeaderValues = function(values) {
  return values.replace(/\s+/g, " ").trim();
}

S3Request.prototype.signedHeaders = function() {
  var keys = [];
  for (var key in this.headers) {
    var lowerKey = key.toLowerCase();
    if (this.isSignableHeader(lowerKey)) {
      keys.push(lowerKey);
    }
  }
  return keys.sort().join(';');
}

S3Request.prototype.credentialString = function(datetime) {
  return [
    datetime.substr(0, 8),
    this.region,
    this.serviceName,
    'aws4_request'
  ].join('/');
}

S3Request.prototype.hexEncodedHash = function(string) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, string, Utilities.Charset.UTF_8);
  return this.hex(digest);
}

S3Request.prototype.hexEncodedBodyHash = function() {
  if (this.isPresigned() && !this.content.length) {
    return 'UNSIGNED-PAYLOAD'
  } else if (this.headers['X-Amz-Content-Sha256']) {
    return this.headers['X-Amz-Content-Sha256']
  } else {
    var contentToHash = this.content || '';
    var digest;
    if (typeof contentToHash === 'string') {
        digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contentToHash, Utilities.Charset.UTF_8);
    } else { // Assume byte[]
        digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contentToHash);
    }
    return this.hex(digest);
  }
}

S3Request.prototype.isSignableHeader = function(key) {
  var lowerKey = key.toLowerCase();
  if (lowerKey.indexOf('x-amz-') === 0) return true;
  var unsignableHeaders = [
    'authorization', 'content-type', 'content-length', 'user-agent',
    this.expiresHeader, 'expect', 'x-amzn-trace-id'
  ];
  return unsignableHeaders.indexOf(lowerKey) < 0;
}

S3Request.prototype.isPresigned = function() {
  return this.headers[this.expiresHeader] ? true : false;
}
