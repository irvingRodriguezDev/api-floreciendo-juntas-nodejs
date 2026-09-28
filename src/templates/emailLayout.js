// templates/emailLayout.js
module.exports = (content) => `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notificación de Boleto</title>
</head>
<body style="margin:0; padding:30px 10px; background-color:#f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 20px; padding: 40px 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <tr>
      <td align="center">
        ${content}
      </td>
    </tr>
  </table>
</body>
</html>
`;
