const jwt = require("jsonwebtoken");
const fs = require("fs");
const crypto = require("crypto");
// Leer la private key una sola vez
const privateKey = fs.readFileSync("./private-key-fj-lives.pem", "utf8");

const getToken = (req, res) => {
  try {
    const channelArn = process.env.AWS_IVS_CHANNEL_ARN;

    const payload = {
      "aws:channel-arn": channelArn,
      aud: "ivs.amazonaws.com",
      exp: Math.floor(Date.now() / 1000) + 60 * 5, // ⏱ 5 minutos
      sub: req.user?.id || "viewer",
    };

    const token = jwt.sign(payload, privateKey, {
      algorithm: "ES384", // ✅ correcto
      keyid: process.env.AWS_IVS_KEY_ID, // ✅ obligatorio
    });

    return res.status(200).json({ token: token });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
};

const testIvsConfig = (req, res) => {
  try {
    // 1. Verificar que la private key sea válida
    const keyObject = crypto.createPrivateKey(privateKey);

    console.log("✅ Private key es válida");
    console.log("Tipo:", keyObject.asymmetricKeyType); // Debe ser 'ec'
    console.log("Formato:", keyObject.format); // Debe ser 'pem'

    // 2. Extraer la public key desde la private key
    const publicKey = crypto.createPublicKey(keyObject);
    const publicKeyPem = publicKey.export({
      type: "spki",
      format: "pem",
    });

    console.log("📄 Public key derivada de la private key:");
    console.log(publicKeyPem);

    // 3. Generar un token de prueba
    const testPayload = {
      "aws:channel-arn": process.env.AWS_IVS_CHANNEL_ARN,
      "aws:access-control-allow-origin": "*",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const testToken = jwt.sign(testPayload, privateKey, {
      algorithm: "ES384",
      keyid: process.env.AWS_IVS_KEY_ID,
    });

    // Decodificar para verificar
    const decoded = jwt.decode(testToken, { complete: true });

    return res.status(200).json({
      success: true,
      keyType: keyObject.asymmetricKeyType,
      publicKeyPem: publicKeyPem,
      tokenHeader: decoded.header,
      tokenPayload: decoded.payload,
      message: "Compara esta public key con la que tienes registrada en AWS",
    });
  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({
      error: error.message,
      stack: error.stack,
    });
  }
};
module.exports = { getToken, testIvsConfig };
