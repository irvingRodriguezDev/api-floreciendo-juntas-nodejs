const puppeteer = require("puppeteer");
const { Order, OrderPayment, User } = require("../models");
const orderStatementTemplate = require("../views/orderStatementTemplate");

const generateOrderAccountStatement = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findByPk(orderId, {
      include: [
        { model: User, as: "user", attributes: ["name", "email"] },
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
          order: [["paymentDate", "ASC"]],
        },
      ],
    });

    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    // Generar HTML con el template
    const html = orderStatementTemplate(order);

    // Generar PDF con Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    // Enviar PDF como descarga
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=estado_cuenta_${order.id}.pdf`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error("🚨 Error generando PDF:", error.message);
    res.status(500).json({ error: "Error generando el estado de cuenta" });
  }
};

module.exports = { generateOrderAccountStatement };
