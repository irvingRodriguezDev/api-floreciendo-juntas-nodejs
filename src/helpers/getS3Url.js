const getS3Url = (path) => {
  if (!path) return null; // Si no hay imagen, retorna null

  // Asegura que el path empiece con "/"
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com${normalizedPath}`;
};

module.exports = getS3Url;
