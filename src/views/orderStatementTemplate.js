const { format } = require("date-fns");

module.exports = function orderStatementTemplate(order) {
  const formatDate = (date) =>
    date ? format(new Date(date), "dd/MM/yyyy") : "-";

  /** -----------------------
   *  DETALLE DE PRODUCTOS
   *  ----------------------*/
  const itemsRows =
    order.items && order.items.length > 0
      ? order.items
          .map(
            (item) => `
        <tr>
          <td>${item.product?.name || "-"}</td>
          <td>${item.quantity}</td>
          <td>$${item.unitPrice}</td>
          <td>$${item.subtotal}</td>
        </tr>
      `
          )
          .join("")
      : `<tr><td colspan="4" style="text-align:center;">Sin productos registrados</td></tr>`;

  /** -----------------------
   *  HISTORIAL DE PAGOS
   *  ----------------------*/
  const paymentsRows =
    order.payments.length > 0
      ? order.payments
          .map(
            (p) => `
        <tr>
          <td>${formatDate(p.paymentDate)}</td>
          <td>${p.paymentMethod}</td>
          <td>${p.type === "initial" ? "Pago inicial" : "Abono"}</td>
          <td>${p.status}</td>
          <td>$${p.amount}</td>
          <td>${p.reference || "-"}</td>
        </tr>
      `
          )
          .join("")
      : `<tr><td colspan="6" style="text-align:center;">Sin pagos registrados</td></tr>`;

  /** -----------------------
   *  HTML COMPLETO
   *  ----------------------*/

  return `
 <!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 20px 30px; /* Mantienes tu espacio interno */
      background-color: #fff6fa; /* Tu color de fondo */
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #333;
    }

    /* Header */
    header {
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      margin-bottom: 35px;
    }

    header img {
      position: absolute;
      left: 0;
      width: 130px;
      height: auto;
    }

    .title-container {
      text-align: center;
      width: 100%;
    }

    h1 {
      color: #d63384;
      margin: 0;
      font-size: 26px;
    }

    .issue-date {
      text-align: right;
      margin-bottom: 10px;
      font-size: 13px;
    }

    /* Sections */
    section {
      background-color: #ffffff;
      border-radius: 12px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.05);
      padding: 20px 25px;
      margin-bottom: 20px;
    }

    h2 {
      color: #d63384;
      font-size: 18px;
      border-bottom: 2px solid #f3c4d3;
      padding-bottom: 4px;
      margin-bottom: 12px;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
      font-size: 13px;
    }

    th {
      background-color: #d63384;
      color: white;
      padding: 8px;
      text-align: left;
    }

    td {
      border-bottom: 1px solid #eee;
      padding: 8px;
    }

    tr:nth-child(even) {
      background-color: #fff2f7;
    }

    /* Summary */
    .summary {
      text-align: right;
      margin-top: 25px;
      font-size: 14px;
      line-height: 1.6;
    }

    footer {
      margin-top: 40px;
      text-align: center;
      font-size: 11px;
      color: #888;
    }
  </style>
</head>

<body>

  <div class="issue-date">
    <b>Fecha de Emisión:</b> ${formatDate(new Date())}
  </div>

  <header>
    <img 
      src="https://floreciendojuntas1.s3.us-east-2.amazonaws.com/local/Statics/logo_salon_de_tus_sue%C3%B1os" 
      alt="Logo"
    />
    <div class="title-container">
      <h1>Estado de Cuenta</h1>
    </div>
  </header>

  <section>
    <h2>Información del Cliente</h2>
    <p><b>Nombre:</b> ${order.user.name}</p>
    <p><b>Correo:</b> ${order.user.email}</p>
  </section>

  <section>
    <h2>Información de la Orden</h2>
    <p><b>ID Orden:</b> ${order.id}</p>
    <p><b>Fecha de Creación:</b> ${formatDate(order.createdAt)}</p>
    <p><b>Fecha Límite:</b> ${formatDate(order.dueDate)}</p>
    <p><b>Estatus:</b> ${order.status}</p>
    <p><b>Total Orden:</b> $${order.totalAmount}</p>
  </section>

  <section>
    <h2>Detalle de Productos</h2>
    <table>
      <thead>
        <tr>
          <th>Producto</th>
          <th>Cantidad</th>
          <th>Precio Unitario</th>
          <th>Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Historial de Pagos</h2>
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Método</th>
          <th>Tipo</th>
          <th>Estado</th>
          <th>Monto</th>
          <th>Referencia</th>
        </tr>
      </thead>
      <tbody>
        ${paymentsRows}
      </tbody>
    </table>
  </section>

  <section class="summary">
    <p><b>Total Pagado:</b> $${order.paidAmount}</p>
    <p><b>Restante:</b> $${order.remainingAmount}</p>
  </section>

  <footer>
    Este documento es un comprobante informativo.  
    Gracias por ser parte de <b>Floreciendo Juntas</b> 💕
  </footer>

</body>
</html>
`;
};
