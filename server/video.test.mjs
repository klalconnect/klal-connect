// The upload-link signature, checked against the worked example in AWS's
// SigV4 query-string documentation.
import assert from 'node:assert/strict';
import { presign } from './video.js';

const url = presign({
  method: 'GET',
  host: 'examplebucket.s3.amazonaws.com',
  path: '/test.txt',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  expires: 86400,
  now: new Date('2013-05-24T00:00:00Z'),
});
assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
console.log('video signing ok');
