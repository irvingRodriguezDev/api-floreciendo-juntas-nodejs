const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const fs = require("fs");
require("dotenv").config();

// Inicializar cliente Lambda
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-2",
});

/**
 * 🧪 Script de prueba para invocar Lambda desde local
 */
const testLambdaPDF = async () => {
  try {
    console.log("🚀 Iniciando prueba de Lambda...\n");

    // HTML de prueba simple
    const testHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 40px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    h1 {
      color: #667eea;
      text-align: center;
    }
    .info {
      margin: 20px 0;
      padding: 15px;
      background: #f3f4f6;
      border-radius: 5px;
    }
    .emoji {
      font-size: 48px;
      text-align: center;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎉 Prueba de Lambda PDF</h1>
    <div class="emoji">🚀</div>
    <div class="info">
      <strong>Estado:</strong> Generado exitosamente<br>
      <strong>Fecha:</strong> ${new Date().toLocaleString("es-MX")}<br>
      <strong>Servicio:</strong> AWS Lambda + Puppeteer<br>
      <strong>Región:</strong> ${process.env.AWS_REGION}
    </div>
    <p style="text-align: center; color: #666;">
      Si puedes ver este PDF, ¡la integración funciona correctamente! ✅
    </p>
  </div>
</body>
</html>
    `;

    // Preparar payload para Lambda
    const lambdaPayload = {
      html: testHTML,
      format: "A4",
      fileName: "test-lambda.pdf",
    };

    console.log("📤 Invocando Lambda:", process.env.LAMBDA_PDF_FUNCTION_NAME);
    console.log("📍 Región:", process.env.AWS_REGION);
    console.log("⏳ Esperando respuesta...\n");

    const startTime = Date.now();

    // Invocar Lambda
    const command = new InvokeCommand({
      FunctionName:
        process.env.LAMBDA_PDF_FUNCTION_NAME || "puppeteer-pdf-generator",
      Payload: JSON.stringify(lambdaPayload),
    });

    const lambdaResponse = await lambdaClient.send(command);

    const duration = Date.now() - startTime;
    console.log(`⚡ Tiempo de respuesta: ${duration}ms\n`);

    // Parsear respuesta
    const responsePayload = JSON.parse(
      Buffer.from(lambdaResponse.Payload).toString()
    );

    if (responsePayload.statusCode !== 200) {
      throw new Error(`Lambda error: ${JSON.stringify(responsePayload)}`);
    }

    // Decodificar PDF de base64
    const pdfBase64 = responsePayload.body;
    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    // Guardar PDF localmente
    const outputPath = "./test-lambda-output.pdf";
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log("✅ ¡PDF generado exitosamente!");
    console.log(`📁 Guardado en: ${outputPath}`);
    console.log(`📊 Tamaño: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    console.log("\n🎉 Prueba completada con éxito!\n");
  } catch (error) {
    console.error("\n❌ Error en la prueba:");
    console.error("Tipo:", error.name);
    console.error("Mensaje:", error.message);

    if (error.Code) {
      console.error("Código AWS:", error.Code);
    }

    if (error.message.includes("credentials")) {
      console.error(
        "\n💡 Tip: Verifica tus credenciales AWS con: aws configure list"
      );
    }

    if (error.message.includes("not found")) {
      console.error(
        "\n💡 Tip: Verifica que la Lambda existe con: aws lambda get-function --function-name puppeteer-pdf-generator"
      );
    }

    console.error("\n");
    process.exit(1);
  }
};

// Ejecutar prueba
testLambdaPDF();
