const axios = require("axios");

const verifyCaptcha = async (req, res, next) => {
  const token = req.body.captchaToken;

  if (!token) {
    return res.status(400).json({ msg: "Captcha no proporcionado" });
  }

  try {
    // 1. Usamos un objeto URLSearchParams para enviar los datos en el BODY
    // Esto evita que el SECRET y el TOKEN aparezcan en la URL del log de Axios
    const params = new URLSearchParams();
    params.append("secret", process.env.RECAPTCHA_SECRET_KEY);
    params.append("response", token);

    const response = await axios.post(
      "https://www.google.com/recaptcha/api/siteverify",
      params,
      {
        timeout: 5000, // 2. Si Google no responde en 5s, saltamos al catch
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    const { success, score } = response.data;

    if (success && score >= 0.5) {
      next();
    } else {
      res.status(403).json({
        msg: "Validación de seguridad fallida",
        score: score || 0,
      });
    }
  } catch (error) {
    /** * 3. MANEJO DE LOGS SEGURO
     * No imprimimos 'error' directamente porque Axios vuelca todo el config
     * (incluyendo el secret). Solo imprimimos lo necesario para debuguear.
     */
    console.error("Error validando reCAPTCHA:", {
      code: error.code, // Ej: 'ETIMEDOUT'
      message: error.message, // Ej: 'timeout of 5000ms exceeded'
      status: error.response?.status,
    });

    // 4. ESTRATEGIA DE FALLO (Fail-open vs Fail-closed)
    // Si Google se cae, ¿quieres bloquear a todos o dejarlos pasar?
    // Aquí decidimos dejar pasar (next) para no romper el buscador si Google falla.
    next();
  }
};

module.exports = verifyCaptcha;
