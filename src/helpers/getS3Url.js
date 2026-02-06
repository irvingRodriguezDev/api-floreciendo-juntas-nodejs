const getS3Url = (path) => {
  if (!path) return null;

  // Normaliza el path
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  // Si hay CDN, úsalo (CloudFront)
  if (process.env.AWS_CDN_URL) {
    return `https://${process.env.AWS_CDN_URL}${normalizedPath}`;
  }

  // Fallback directo a S3 (local / emergencia)
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com${normalizedPath}`;
};

module.exports = getS3Url;
