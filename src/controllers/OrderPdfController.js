const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { Order, OrderPayment, User, OrderItem, Product } = require("../models");
const orderStatementTemplate = require("../views/orderStatementTemplate");

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-2",
});

const generateOrderAccountStatement = async (req, res) => {
  try {
    const { orderId } = req.params;

    // 1. Obtener datos de la orden
    const order = await Order.findByPk(orderId, {
      include: [
        { model: User, as: "user", attributes: ["name", "email"] },
        {
          model: OrderItem,
          as: "items",
          attributes: ["quantity", "unitPrice", "subtotal"],
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["name", "description", "price"],
            },
          ],
        },
        {
          model: OrderPayment,
          as: "payments",
          attributes: [
            "amount",
            "paymentMethod",
            "type",
            "status",
            "reference",
            "paymentDate",
          ],
          separate: true,
          order: [["paymentDate", "ASC"]],
        },
      ],
    });

    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    // 2. Generar HTML
    const html = orderStatementTemplate(order);

    console.log(`🚀 Invocando Lambda nueva para estado de cuenta #${order.id}`);

    const lambdaPayload = {
      html,
      fileName: `estado_cuenta_${order.id}.pdf`,
      prefix: "statements",
    };

    const command = new InvokeCommand({
      FunctionName:
        process.env.LAMBDA_STATEMENT_FUNCTION_NAME ||
        "CreatePdfStatementDreamSalon",
      Payload: JSON.stringify(lambdaPayload),
    });

    const lambdaResponse = await lambdaClient.send(command);

    // -----------------------------
    // ✅ CORRECCIÓN IMPORTANTE AQUÍ
    // -----------------------------
    let rawPayload = lambdaResponse.Payload;

    // Convertir el Uint8ArrayBlobAdapter a buffer real
    if (rawPayload?.buffer) {
      rawPayload = Buffer.from(rawPayload);
    }

    // Convertir a string
    rawPayload = rawPayload.toString();

    // Parsear el payload principal
    rawPayload = JSON.parse(rawPayload);

    // Validar statusCode
    if (rawPayload.statusCode !== 200) {
      throw new Error(rawPayload.body);
    }

    // Parsear el body (viene doble)
    let lambdaBody = rawPayload.body;
    if (typeof lambdaBody === "string") {
      lambdaBody = JSON.parse(lambdaBody);
    }

    const fileUrl = lambdaBody.url;
    return res.json({ url: fileUrl });
  } catch (error) {
    console.error("🚨 Error generando estado de cuenta:", error);
    res.status(500).json({
      error: "Error generando el estado de cuenta",
      details: error.message,
    });
  }
};

module.exports = { generateOrderAccountStatement };
