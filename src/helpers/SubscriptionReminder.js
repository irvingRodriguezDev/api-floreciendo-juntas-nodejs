
const generateSubscriptionReminder = (user, subscription) => {
  const renewalDate = new Date(subscription.next_renewal);
  const timeZone = "America/Mexico_City";

  const formattedDate = renewalDate.toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  });

  const getDate = (date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.map(({ type, value }) => [type, value])
    );

    return Date.UTC(values.year, values.month - 1, values.day);
  };

  const daysRemaining = Math.max(
    0,
    Math.round((getDate(renewalDate) - getDate(new Date())) / 86400000)
  );

  const formattedDays = String(daysRemaining).padStart(2, "0");

  const escapeHTML = (value = "") =>
    String(value).replace(/[&<>"']/g, char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]
    );

  const name = escapeHTML(user.name || "Usuario");

  const formattedAmount = Number(subscription.amount ?? 200)
    .toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN",
    });

  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recordatorio de renovación - Floreciendo Juntas</title>

    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background: #fff5f9;
            font-family: 'DM Sans', Arial, sans-serif;
            color: #596273;
            padding: 40px 20px;
        }

        .wrapper {
            max-width: 580px;
            margin: auto;
        }

        .header, .body, .footer {
            text-align: center;
        }

        .header {
            background: linear-gradient(135deg, #fceaf2, #fff5f9);
            padding: 40px;
            border: 1px solid #f8e0eb;
        }

        .logo {
            width: 220px;
            max-width: 100%;
            height: auto;
        }

        .header-eyebrow {
            font-size: 20px;
            letter-spacing: 3px;
            text-transform: uppercase;
            color: #c2185b;
            margin: 20px 0 16px;
        }

        .header h1 {
            font: 600 38px/1.15 'Cormorant Garamond', Georgia, serif;
            color: #c9327d;
        }

        .header h1 span {
            color: #ec4899;
            font-style: italic;
        }

        .header-line {
            width: 48px;
            height: 3px;
            background: linear-gradient(90deg, #ec4899, #f3b9cd);
            border-radius: 10px;
            margin: 20px auto 0;
        }

        .body {
            background: #fff;
            padding: 44px 40px;
            border: 1px solid #f0dce7;
            border-top: none;
            text-align: left;
        }

        .greeting {
            font: 600 26px system-ui;
            color: #c9327d;
            margin-bottom: 12px;
        }

        .subtext {
            font-size: 14px;
            line-height: 1.8;
            margin-bottom: 30px;
        }

        .subtext strong {
            color: #ec4899;
        }

        .renewal-card, .date-box, .countdown, .notice {
            border-radius: 14px;
            margin-bottom: 28px;
        }

        .renewal-card {
            background: #fff5f9;
            border: 1px solid #f3d0de;
            padding: 28px;
        }

        .renewal-label, .date-box-label {
            font-size: 10px;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 12px;
        }

        .renewal-label {
            color: #ec4899;
        }

        .renewal-title {
            font: 600 30px 'Cormorant Garamond', Georgia, serif;
            color: #c9327d;
            margin-bottom: 22px;
        }

        .date-box {
            background: #fff;
            border: 1px solid #f3d0de;
            padding: 20px;
            text-align: center;
            margin-bottom: 0;
        }

        .date-box-label {
            color: #7a5568;
        }

        .date-box-value {
            font-size: 19px;
            font-weight: 600;
            color: #c2185b;
        }

        .countdown {
            background: linear-gradient(135deg, #e8328a, #c2185b);
            padding: 28px 24px;
            text-align: center;
        }

        .countdown-number {
            font: 600 52px system-ui;
            color: #fff;
            line-height: 1;
        }

        .countdown-text {
            font-size: 11px;
            color: #fff;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-top: 10px;
        }

        .notice {
            background: #fffbeb;
            border: 1px solid #fde68a;
            padding: 18px;
            margin-bottom: 0;
        }

        .notice-text {
            font-size: 12px;
            color: #78350f;
            line-height: 1.8;
        }

        .notice-text strong {
            color: #92400e;
        }

        .footer {
            background: #fff5f9;
            border: 1px solid #f0dce7;
            border-top: none;
            border-radius: 0 0 16px 16px;
            padding: 28px 40px;
        }

        .footer-brand {
            font: 600 22px 'Cormorant Garamond', Georgia, serif;
            color: #c9327d;
            margin-bottom: 8px;
        }

        .footer-meta {
            font-size: 11px;
            color: #7a5568;
            line-height: 1.8;
        }

        @media (max-width: 480px) {
            body {
                padding: 20px 12px;
            }

            .logo {
                width: 160px;
            }

            .header, .body, .footer {
                padding-left: 24px;
                padding-right: 24px;
            }

            .header h1 {
                font-size: 32px;
            }

            .renewal-card {
                padding: 20px;
            }

            .renewal-title {
                font-size: 26px;
            }

            .date-box-value {
                font-size: 16px;
            }
        }
    </style>
</head>

<body>
    <div class="wrapper">

        <div class="header">
            <img
                src="https://cdn.floreciendojuntas.com/production/statics/LOGOTIPO+FLORECIENDO+JUNTAS+negro.png"
                alt="Floreciendo Juntas"
                class="logo"
                width="220"
            >

            <h2 class="header-eyebrow">Recordatorio de renovación</h2>
            <div class="header-line"></div>
        </div>

        <div class="body">
            <p class="greeting">¡Hola, ${name}! 👋</p>

            <p class="subtext">
                Queremos recordarte que tu suscripción está próxima a renovarse.
                En <strong>${daysRemaining} días</strong> llegará la fecha de tu siguiente
                renovación. ¡Nos encanta que sigas formando parte
                de nuestra comunidad!
            </p>

            <div class="renewal-card">
                <p class="renewal-label">Información de tu suscripción</p>
                <h2 class="renewal-title">Próxima renovación</h2>

                <div class="date-box">
                    <p class="date-box-label">Fecha programada</p>
                    <p class="date-box-value">${formattedDate}</p>
                </div>
            </div>

            <div class="countdown">
                <p class="countdown-number">${formattedDays}</p>
                <p class="countdown-text">Días para tu renovación</p>
            </div>

            <div class="notice">
                <p class="notice-text">
                    <strong>Importante:</strong>
                    En esta fecha se realizará automáticamente un nuevo cargo
                    de <strong>${formattedAmount}</strong> correspondiente
                    a tu suscripción.

                    <br><br>

                    Si deseas cancelar tu suscripción y evitar el siguiente cobro,
                    recuerda realizar la cancelación con al menos
                    <strong>48 horas de anticipación</strong> a la fecha de renovación.

                    <br><br>

                    Puedes cancelar tu suscripción fácilmente desde tu perfil.
                </p>
            </div>
        </div>

        <div class="footer">
            <p class="footer-brand">Floreciendo Juntas</p>
            <p class="footer-meta">
                Este es un mensaje automático para recordarte tu próxima renovación.
                <br>
                Gracias por seguir confiando en nosotros.
            </p>
        </div>

    </div>
</body>
</html>`;
};

module.exports = generateSubscriptionReminder;
