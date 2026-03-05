const axios = require("axios");

const verifyCaptcha = async (req, res, next) => {
  const token = req.body.captchaToken; // El frontend debe enviar esto

  if (!token) {
    return res.status(400).json({ msg: "Captcha no proporcionado" });
  }

  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`,
    );

    const { success, score } = response.data;

    // success: si el token es válido
    // score: 1.0 es humano, 0.0 es bot. El umbral recomendado es 0.5
    if (success && score >= 0.5) {
      next(); // Es un humano, adelante
    } else {
      res
        .status(403)
        .json({ msg: "Bot detectado o puntaje de seguridad bajo", score });
    }
  } catch (error) {
    console.error("Error validando reCAPTCHA:", error);
    res.status(500).json({ msg: "Error interno en validación de seguridad" });
  }
};

module.exports = verifyCaptcha;
